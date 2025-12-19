'use client';

import React, { useState, useMemo, useEffect } from 'react';

export default function MiningCalculator() {
  // Tier definitions
  const tiers = [
    { name: 'Starter', price: 49, hashrate: 2.0, color: '#10b981' },
    { name: 'Professional', price: 99, hashrate: 4.0, color: '#3b82f6' },
    { name: 'Enterprise', price: 249, hashrate: 10.0, color: '#8b5cf6' },
    { name: 'Premium', price: 499, hashrate: 20.0, color: '#f59e0b' },
  ];

  // State
  const [selectedTier, setSelectedTier] = useState(2);
  const [currentBtcPrice, setCurrentBtcPrice] = useState(null);
  const [historicalBtcPrice, setHistoricalBtcPrice] = useState(null);
  // Hashprice is not sourced from CoinGecko; use a reasonable default but persist user edits locally.
  const [hashpriceUsd, setHashpriceUsd] = useState(0.063);
  const [electricityCostKwh, setElectricityCostKwh] = useState(0.05);
  const [wattsPerTh, setWattsPerTh] = useState(29.5);
  const [contractMonths, setContractMonths] = useState(24);
  const [btcGrowthScenario, setBtcGrowthScenario] = useState('historical');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [priceError, setPriceError] = useState(null);

  // Intentionally no persistence: a browser refresh should reset inputs to defaults.

  // Calculate historical growth multiplier
  const historicalMultiplier = useMemo(() => {
    if (historicalBtcPrice && historicalBtcPrice > 0 && currentBtcPrice && currentBtcPrice > 0) {
      return currentBtcPrice / historicalBtcPrice;
    }
    return null;
  }, [currentBtcPrice, historicalBtcPrice]);

  // Fetch BTC prices on mount and set up refresh
  useEffect(() => {
    const fetchPrices = async () => {
      setIsLoading(true);
      setPriceError(null);
      
      try {
        const res = await fetch('/api/btc-prices');
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error || `Price API error: ${res.status} ${res.statusText}`);
        }

        if (typeof data?.currentPriceUsd !== 'number' || data.currentPriceUsd <= 0) {
          throw new Error('Invalid current price from price API');
        }
        if (typeof data?.historicalPriceUsd !== 'number' || data.historicalPriceUsd <= 0) {
          throw new Error('Invalid historical price from price API');
        }

        setCurrentBtcPrice(data.currentPriceUsd);
        setHistoricalBtcPrice(data.historicalPriceUsd);
        
        setLastUpdated(new Date());
        setPriceError(null);
      } catch (error) {
        console.error('Error fetching prices:', error);
        setPriceError(`API Error: ${error.message}`);
        // Don't set fallback values - let the UI show that data is unavailable
      } finally {
        setIsLoading(false);
      }
    };

    fetchPrices();

    // Refresh every 12 hours (twice daily)
    const interval = setInterval(fetchPrices, 12 * 60 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, []);

  // Base multipliers (defined for 24-month period)
  const baseMultipliers = useMemo(() => ({
    bear: { label: 'Bear', base24m: 0.7, color: '#ef4444' },
    flat: { label: 'Flat', base24m: 1.0, color: '#6b7280' },
    base: { label: 'Base', base24m: 2.0, color: '#3b82f6' },
    historical: { 
      label: 'Historical 2yr', 
      base24m: historicalMultiplier, 
      color: '#f7931a',
      isLive: true,
    },
    mega: { label: 'Mega', base24m: 10.0, color: '#a855f7' },
  }), [historicalMultiplier]);

  // Scale multipliers based on contract length (all scenarios defined as 24-month base)
  const growthScenarios = useMemo(() => {
    const scaled = {};
    Object.entries(baseMultipliers).forEach(([key, val]) => {
      const base24m = val.base24m;

      // If we don't have valid live data yet (e.g. historicalMultiplier is null),
      // mark the scenario unavailable rather than coercing to 0 / NaN.
      if (!Number.isFinite(base24m) || base24m <= 0 || contractMonths <= 0) {
        scaled[key] = {
          ...val,
          finalMultiplier: null,
          label: `${val.label} (unavailable)`,
        };
        return;
      }

      // Scale: adjusted = base ^ (contractMonths / 24)
      const scaledMultiplier = Math.pow(base24m, contractMonths / 24);
      const percentChange = ((scaledMultiplier - 1) * 100).toFixed(0);
      const sign = scaledMultiplier >= 1 ? '+' : '';

      scaled[key] = {
        ...val,
        finalMultiplier: scaledMultiplier,
        label: `${val.label} (${scaledMultiplier.toFixed(2)}x / ${sign}${percentChange}%)`,
      };
    });
    return scaled;
  }, [baseMultipliers, contractMonths]);

  // Difficulty growth assumptions (monthly)
  const difficultyGrowthMonthly = 0.04;

  const tier = tiers[selectedTier];
  const scenario = growthScenarios[btcGrowthScenario];

  // Calculate electricity cost per TH per day
  const elecCostPerThPerDay = useMemo(() => {
    const kwhPerThPerDay = (wattsPerTh * 24) / 1000;
    return kwhPerThPerDay * electricityCostKwh;
  }, [wattsPerTh, electricityCostKwh]);

  const monthlyElecCost = elecCostPerThPerDay * tier.hashrate * 30;

  // Calculate monthly projections
  const monthlyProjections = useMemo(() => {
    const projections = [];
    let cumulativeBtc = 0;
    let cumulativeElecCost = 0;

    if (!currentBtcPrice || !Number.isFinite(currentBtcPrice) || currentBtcPrice <= 0) {
      return projections;
    }
    if (!scenario || !Number.isFinite(scenario.finalMultiplier) || scenario.finalMultiplier <= 0) {
      return projections;
    }
    if (!contractMonths || contractMonths <= 0) {
      return projections;
    }

    const monthlyBtcGrowthRate = Math.pow(scenario.finalMultiplier, 1 / contractMonths) - 1;

    for (let month = 1; month <= contractMonths; month++) {
      // Difficulty adjustment reduces BTC earned over time
      // If difficulty grows by 4%, your BTC earnings decrease by 1/1.04 = 3.85%
      // More accurate than (1-0.04) which would be 4% decay
      const difficultyMultiplier = Math.pow(1 / (1 + difficultyGrowthMonthly), month - 1);
      
      // Calculate gross BTC earned this month
      // hashpriceUsd / currentBtcPrice = BTC per TH per day at current difficulty
      const dailyBtcPerTh = (hashpriceUsd / currentBtcPrice) * difficultyMultiplier;
      const monthlyBtcGross = dailyBtcPerTh * tier.hashrate * 30;
      
      // Customer receives GROSS BTC - electricity is paid separately in USD
      // (Not deducted from BTC to avoid double-counting)
      cumulativeBtc += monthlyBtcGross;
      cumulativeElecCost += monthlyElecCost;

      // BTC price appreciation over time
      const btcPriceAtMonth = currentBtcPrice * Math.pow(1 + monthlyBtcGrowthRate, month);
      
      // Portfolio value = accumulated BTC × BTC price at that month
      const portfolioValue = cumulativeBtc * btcPriceAtMonth;
      
      // Total cost = upfront payment + cumulative electricity (both in USD)
      const totalCost = tier.price + cumulativeElecCost;
      
      // ROI = (value - cost) / cost
      const roi = ((portfolioValue - totalCost) / totalCost) * 100;

      projections.push({
        month,
        monthlyBtcGross,
        cumulativeBtc,
        btcPrice: btcPriceAtMonth,
        portfolioValue,
        cumulativeElecCost,
        totalCost,
        roi,
      });
    }

    return projections;
  }, [tier, hashpriceUsd, currentBtcPrice, contractMonths, scenario, monthlyElecCost, difficultyGrowthMonthly]);

  const finalProjection = monthlyProjections[monthlyProjections.length - 1];

  // Format helpers
  const formatUsd = (val) => {
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };
  const formatBtc = (val) => {
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(8);
  };
  const formatPercent = (val) => {
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n)) return '—';
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  };

  // Format date for 2 years ago display
  const twoYearsAgoDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, []);

  const todayDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #0f0f1a 100%)',
      color: '#e2e8f0',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: '24px',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h1 style={{
          fontSize: '28px',
          fontWeight: '700',
          background: 'linear-gradient(90deg, #f7931a, #ffab40)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          marginBottom: '8px',
          letterSpacing: '-0.5px',
        }}>
          ₿ Mining Profitability Calculator
        </h1>
        <p style={{ color: '#64748b', fontSize: '13px' }}>
          Fractional hashrate with live BTC appreciation modeling
        </p>
        
        {/* Live price indicator */}
        <div style={{
          marginTop: '12px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          background: 'rgba(247, 147, 26, 0.1)',
          borderRadius: '20px',
          border: '1px solid rgba(247, 147, 26, 0.3)',
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isLoading ? '#f59e0b' : '#10b981',
            animation: isLoading ? 'pulse 1s infinite' : 'none',
          }} />
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            {isLoading ? 'Fetching live prices...' : (
              currentBtcPrice ? (
                <>
                  Live: <span style={{ color: '#f7931a', fontWeight: '600' }}>{formatUsd(currentBtcPrice)}</span>
                  {lastUpdated && (
                    <span style={{ marginLeft: '8px', opacity: 0.6 }}>
                      Updated {lastUpdated.toLocaleTimeString()}
                    </span>
                  )}
                </>
              ) : (
                <span style={{ color: '#ef4444' }}>Price data unavailable</span>
              )
            )}
          </span>
        </div>
        {priceError && (
          <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '6px' }}>{priceError}</div>
        )}
      </div>

      {/* 2-Year Price Comparison Banner */}
      {currentBtcPrice && historicalBtcPrice && historicalMultiplier ? (
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto 20px',
          padding: '16px 20px',
          background: 'linear-gradient(90deg, rgba(247, 147, 26, 0.15) 0%, rgba(16, 185, 129, 0.15) 100%)',
          borderRadius: '12px',
          border: '1px solid rgba(247, 147, 26, 0.2)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}>
          <div style={{ textAlign: 'center', flex: '1', minWidth: '140px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>{twoYearsAgoDate}</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: '#94a3b8' }}>
              {formatUsd(historicalBtcPrice)}
            </div>
          </div>
          
          <div style={{ textAlign: 'center', flex: '1', minWidth: '120px' }}>
            <div style={{
              fontSize: '24px',
              fontWeight: '800',
              color: '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}>
              <span>→</span>
              <span>{historicalMultiplier.toFixed(2)}x</span>
              <span>→</span>
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>2-Year Growth</div>
          </div>
          
          <div style={{ textAlign: 'center', flex: '1', minWidth: '140px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>{todayDate}</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: '#f7931a' }}>
              {formatUsd(currentBtcPrice)}
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto 20px',
          padding: '16px 20px',
          background: 'rgba(239, 68, 68, 0.1)',
          borderRadius: '12px',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          textAlign: 'center',
          color: '#ef4444',
        }}>
          Price data unavailable. Please wait for API to load or refresh the page.
        </div>
      )}

      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
        
        {/* Tier Selection */}
        <div style={{
          background: 'rgba(30, 30, 50, 0.8)',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <h2 style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Select Tier
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {tiers.map((t, idx) => (
              <button
                key={t.name}
                onClick={() => setSelectedTier(idx)}
                style={{
                  padding: '16px 12px',
                  borderRadius: '8px',
                  border: selectedTier === idx ? `2px solid ${t.color}` : '2px solid rgba(255,255,255,0.1)',
                  background: selectedTier === idx ? `${t.color}15` : 'rgba(0,0,0,0.3)',
                  color: selectedTier === idx ? t.color : '#94a3b8',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '4px' }}>{t.name}</div>
                <div style={{ fontSize: '20px', fontWeight: '700' }}>${t.price}</div>
                <div style={{ fontSize: '12px', opacity: 0.7 }}>{t.hashrate} TH/s</div>
              </button>
            ))}
          </div>
        </div>

        {/* Market Inputs */}
        <div style={{
          background: 'rgba(30, 30, 50, 0.8)',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <h2 style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Market Parameters
          </h2>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>
              <span>Current BTC Price</span>
              <span style={{ color: '#10b981', fontSize: '10px' }}>● LIVE</span>
            </label>
            <input
              type="number"
              value={currentBtcPrice ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') return setCurrentBtcPrice(null);
                const n = Number(raw);
                setCurrentBtcPrice(Number.isFinite(n) ? n : null);
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(0,0,0,0.4)',
                color: '#f7931a',
                fontSize: '16px',
                fontWeight: '600',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>
              Hashprice ($/TH/day)
            </label>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px', lineHeight: 1.4 }}>
              Reference: hashpower marketplace pricing (e.g.{' '}
              <a href="https://www.nicehash.com/" target="_blank" rel="noreferrer" style={{ color: '#94a3b8' }}>
                NiceHash
              </a>
              ). Default is a placeholder—enter your own.
            </div>
            <input
              type="number"
              step="0.001"
              value={hashpriceUsd}
              onChange={(e) => setHashpriceUsd(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(0,0,0,0.4)',
                color: '#e2e8f0',
                fontSize: '16px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>
              Electricity Cost ($/kWh)
            </label>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px', lineHeight: 1.4 }}>
              Reference: your utility bill / contracted power rate. Default is a placeholder.
            </div>
            <input
              type="number"
              step="0.01"
              value={electricityCostKwh}
              onChange={(e) => setElectricityCostKwh(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(0,0,0,0.4)',
                color: '#e2e8f0',
                fontSize: '16px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>
              Contract Length (months)
            </label>
            <input
              type="range"
              min="6"
              max="36"
              value={contractMonths}
              onChange={(e) => setContractMonths(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#f7931a' }}
            />
            <div style={{ textAlign: 'center', color: '#f7931a', fontWeight: '600' }}>{contractMonths} months</div>
          </div>
        </div>

        {/* BTC Growth Scenario */}
        <div style={{
          background: 'rgba(30, 30, 50, 0.8)',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <h2 style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            BTC Growth Scenario
          </h2>
          <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '12px' }}>
            Scaled for {contractMonths}-month contract
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(growthScenarios).map(([key, val]) => (
              <button
                key={key}
                onClick={() => setBtcGrowthScenario(key)}
                style={{
                  padding: '12px 16px',
                  borderRadius: '6px',
                  border: btcGrowthScenario === key ? `2px solid ${val.color}` : '2px solid rgba(255,255,255,0.1)',
                  background: btcGrowthScenario === key ? `${val.color}20` : 'rgba(0,0,0,0.3)',
                  color: btcGrowthScenario === key ? val.color : '#64748b',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'all 0.2s',
                  position: 'relative',
                }}
              >
                <span style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span>{val.label}</span>
                  {val.isLive && (
                    <span style={{
                      fontSize: '9px',
                      background: '#f7931a',
                      color: '#000',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: '700',
                    }}>
                      LIVE
                    </span>
                  )}
                </span>
                <span style={{ fontSize: '12px', opacity: 0.7, textAlign: 'right' }}>
                  → {(currentBtcPrice && Number.isFinite(val.finalMultiplier))
                    ? formatUsd(currentBtcPrice * val.finalMultiplier)
                    : '—'}
                </span>
              </button>
            ))}
          </div>
          <p style={{ fontSize: '11px', color: '#64748b', marginTop: '12px', lineHeight: 1.5 }}>
            All scenarios defined as 24-month base rates, scaled proportionally for {contractMonths}-month contract. Historical uses actual BTC growth from {twoYearsAgoDate} to today.
          </p>
        </div>

        {/* Results Summary */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(247, 147, 26, 0.15) 0%, rgba(30, 30, 50, 0.9) 100%)',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid rgba(247, 147, 26, 0.3)',
        }}>
          <h2 style={{ fontSize: '14px', color: '#f7931a', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {contractMonths}-Month Projection
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Total BTC Accumulated</div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#f7931a' }}>
                ₿ {formatBtc(finalProjection?.cumulativeBtc || 0)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Final BTC Price</div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#10b981' }}>
                {formatUsd(finalProjection?.btcPrice || 0)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Portfolio Value</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#e2e8f0' }}>
                {formatUsd(finalProjection?.portfolioValue || 0)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Total Cost (Upfront + Elec)</div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#94a3b8' }}>
                {formatUsd(finalProjection?.totalCost || 0)}
              </div>
            </div>
          </div>

          <div style={{
            marginTop: '20px',
            padding: '16px',
            borderRadius: '8px',
            background: finalProjection?.roi >= 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            border: `1px solid ${finalProjection?.roi >= 0 ? '#10b981' : '#ef4444'}`,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Return on Investment</div>
            <div style={{
              fontSize: '32px',
              fontWeight: '800',
              color: finalProjection?.roi >= 0 ? '#10b981' : '#ef4444',
            }}>
              {formatPercent(finalProjection?.roi || 0)}
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Breakdown Chart */}
      <div style={{
        maxWidth: '1200px',
        margin: '20px auto 0',
        background: 'rgba(30, 30, 50, 0.8)',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <h2 style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Monthly Accumulation & Value
        </h2>
        
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '120px', marginBottom: '16px' }}>
          {monthlyProjections.map((p, idx) => {
            const maxVal = Math.max(...monthlyProjections.map(x => x.portfolioValue));
            const height = (p.portfolioValue / maxVal) * 100;
            const isBreakeven = p.portfolioValue >= p.totalCost;
            return (
              <div
                key={idx}
                style={{
                  flex: 1,
                  height: `${height}%`,
                  background: isBreakeven 
                    ? `linear-gradient(180deg, #10b981 0%, #059669 100%)`
                    : `linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)`,
                  borderRadius: '2px 2px 0 0',
                  minWidth: '8px',
                  transition: 'height 0.3s',
                }}
                title={`Month ${p.month}: ${formatUsd(p.portfolioValue)}`}
              />
            );
          })}
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', background: '#10b981', borderRadius: '2px' }} />
            <span style={{ color: '#94a3b8' }}>Profitable</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', background: '#ef4444', borderRadius: '2px' }} />
            <span style={{ color: '#94a3b8' }}>Below Cost</span>
          </div>
        </div>

        <div style={{
          marginTop: '20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '12px',
        }}>
          {[6, 12, 18, 24].filter(m => m <= contractMonths).map(m => {
            const p = monthlyProjections[m - 1];
            if (!p) return null;
            return (
              <div key={m} style={{
                padding: '12px',
                background: 'rgba(0,0,0,0.3)',
                borderRadius: '6px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Month {m}</div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#e2e8f0' }}>{formatUsd(p.portfolioValue)}</div>
                <div style={{ 
                  fontSize: '12px', 
                  color: p.roi >= 0 ? '#10b981' : '#ef4444',
                  fontWeight: '600',
                }}>
                  {formatPercent(p.roi)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cost Breakdown */}
      <div style={{
        maxWidth: '1200px',
        margin: '20px auto 0',
        background: 'rgba(30, 30, 50, 0.8)',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <h2 style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Cost Breakdown
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Upfront (One-time)</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: tier.color }}>{formatUsd(tier.price)}</div>
          </div>
          <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Monthly Electricity</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#f59e0b' }}>{formatUsd(monthlyElecCost)}/mo</div>
          </div>
          <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Total {contractMonths}mo Electricity</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#f59e0b' }}>{formatUsd(monthlyElecCost * contractMonths)}</div>
          </div>
          <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>All-In Cost</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#e2e8f0' }}>{formatUsd(tier.price + (monthlyElecCost * contractMonths))}</div>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{
        maxWidth: '1200px',
        margin: '20px auto 0',
        padding: '16px',
        background: 'rgba(239, 68, 68, 0.1)',
        borderRadius: '8px',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        fontSize: '11px',
        color: '#94a3b8',
        lineHeight: 1.6,
      }}>
        <strong style={{ color: '#ef4444' }}>⚠️ Disclaimer:</strong> Projections are estimates only. Actual returns depend on Bitcoin price movements, network difficulty changes, transaction fees, and hardware uptime. Past performance (including historical BTC growth) does not guarantee future results. Mining involves significant risk including potential loss of principal. Difficulty is assumed to grow ~4% monthly on average. Prices from CoinGecko API, updated twice daily. Not financial advice.
      </div>
    </div>
  );
}
