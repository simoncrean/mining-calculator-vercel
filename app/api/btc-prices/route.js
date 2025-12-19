import { NextResponse } from 'next/server';

// In-memory cache (best-effort). On serverless this may reset between cold starts,
// so we also set CDN-friendly Cache-Control headers on the response.
const CACHE_TTL_SECONDS = Number(process.env.BTC_PRICE_CACHE_TTL_SECONDS || 900); // 15 min
let cachedValue = null; // { payload, cachedAtMs }
let inFlight = null; // Promise resolving to payload

function pickClosestCandleClose(candles, targetSec) {
  // Coinbase candles format: [[timeSec, low, high, open, close, volume], ...]
  let closest = null;
  let closestDiff = Infinity;
  for (const c of candles) {
    if (!Array.isArray(c) || c.length < 5) continue;
    const [timeSec, , , , close] = c;
    if (typeof timeSec !== 'number' || typeof close !== 'number') continue;
    const diff = Math.abs(timeSec - targetSec);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = close;
    }
  }
  return closest;
}

function pickClosestPrice(prices, targetMs) {
  // prices format: [[timestampMs, price], ...]
  let closest = null;
  let closestDiff = Infinity;
  for (const entry of prices) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [ts, price] = entry;
    if (typeof ts !== 'number' || typeof price !== 'number') continue;
    const diff = Math.abs(ts - targetMs);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = price;
    }
  }
  return closest;
}

function okJson(payload, cacheStatus) {
  const res = NextResponse.json(payload, { status: 200 });
  // s-maxage enables shared caching on platforms like Vercel; stale-while-revalidate
  // avoids thundering herds while keeping responses fresh.
  res.headers.set(
    'Cache-Control',
    `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`
  );
  res.headers.set('x-cache', cacheStatus);
  return res;
}

function errJson(message, status = 502, cacheStatus = 'MISS') {
  const res = NextResponse.json({ error: message }, { status });
  // Cache errors briefly to reduce retry storms if CoinGecko is down/rate-limiting.
  res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
  res.headers.set('x-cache', cacheStatus);
  return res;
}

async function fetchFromCoinGecko() {
  try {
    const baseUrl = process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3';
    const apiKey = process.env.COINGECKO_API_KEY;

    const headers = {};
    // CoinGecko uses this header for demo/pro keys depending on plan.
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

    const currentUrl = `${baseUrl}/simple/price?ids=bitcoin&vs_currencies=usd`;
    const currentRes = await fetch(currentUrl, {
      headers,
      // Let Next.js cache this fetch for a short time as an extra layer of protection.
      next: { revalidate: CACHE_TTL_SECONDS },
    });
    if (!currentRes.ok) {
      throw new Error(`CoinGecko current price error: ${currentRes.status} ${currentRes.statusText}`);
    }
    const currentJson = await currentRes.json();
    const currentPrice = currentJson?.bitcoin?.usd;
    if (typeof currentPrice !== 'number' || currentPrice <= 0) {
      throw new Error('Invalid current price payload from CoinGecko');
    }

    const now = new Date();
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const targetSec = Math.floor(twoYearsAgo.getTime() / 1000);

    // Historical (2y ago): CoinGecko public (no-key) returns 401 for /coins/* endpoints in some environments.
    // Strategy:
    // - If COINGECKO_API_KEY exists, try CoinGecko historical.
    // - Otherwise (or on 401), fall back to Coinbase public candles (BTC-USD), which works keyless.
    let historicalPrice = null;

    if (apiKey) {
      // Use a wider window to avoid empty responses and pick closest datapoint.
      const windowDays = 14;
      const fromSec = targetSec;
      const toSec = targetSec + windowDays * 86400;

      const historicalUrl = `${baseUrl}/coins/bitcoin/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}`;
      const histRes = await fetch(historicalUrl, {
        headers,
        next: { revalidate: CACHE_TTL_SECONDS },
      });
      if (histRes.ok) {
        const histJson = await histRes.json();
        const prices = histJson?.prices;
        if (Array.isArray(prices) && prices.length > 0) {
          historicalPrice = pickClosestPrice(prices, twoYearsAgo.getTime());
        }
      } else if (histRes.status !== 401) {
        // If it's not an auth issue, surface the CoinGecko error (so we don't silently mask real problems).
        throw new Error(`CoinGecko historical price error: ${histRes.status} ${histRes.statusText}`);
      }
    }

    if (typeof historicalPrice !== 'number' || historicalPrice <= 0) {
      const windowDays = 14;
      const start = new Date(twoYearsAgo.getTime());
      const end = new Date(twoYearsAgo.getTime() + windowDays * 86400 * 1000);

      const coinbaseUrl =
        `https://api.exchange.coinbase.com/products/BTC-USD/candles` +
        `?granularity=86400&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;

      const cbRes = await fetch(coinbaseUrl, {
        headers: { 'User-Agent': 'mining-calculator-vercel' },
        next: { revalidate: CACHE_TTL_SECONDS },
      });

      if (!cbRes.ok) {
        throw new Error(`Coinbase candles error: ${cbRes.status} ${cbRes.statusText}`);
      }

      const candles = await cbRes.json();
      if (!Array.isArray(candles) || candles.length === 0) {
        throw new Error('No candles returned from Coinbase for historical price');
      }

      historicalPrice = pickClosestCandleClose(candles, targetSec);
      if (typeof historicalPrice !== 'number' || historicalPrice <= 0) {
        throw new Error('Unable to determine historical price from Coinbase candles payload');
      }
    }

    return {
      currentPriceUsd: Math.round(currentPrice),
      historicalPriceUsd: Math.round(historicalPrice),
      historicalTargetDate: twoYearsAgo.toISOString(),
    };
  } catch (e) {
    throw e;
  }
}

export async function GET() {
  const now = Date.now();

  // Fresh cache hit
  if (
    cachedValue &&
    typeof cachedValue.cachedAtMs === 'number' &&
    cachedValue.payload &&
    now - cachedValue.cachedAtMs < CACHE_TTL_SECONDS * 1000
  ) {
    return okJson(cachedValue.payload, 'HIT');
  }

  // Coalesce concurrent requests
  if (!inFlight) {
    inFlight = (async () => {
      const payload = await fetchFromCoinGecko();
      cachedValue = { payload, cachedAtMs: Date.now() };
      return payload;
    })().finally(() => {
      inFlight = null;
    });
  }

  try {
    const payload = await inFlight;
    return okJson(payload, 'MISS');
  } catch (e) {
    return errJson(e?.message || `Server error fetching CoinGecko prices: ${String(e)}`, 502);
  }
}


