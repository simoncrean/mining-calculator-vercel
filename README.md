# Bitcoin Mining Profitability Calculator

A React/Next.js calculator for fractional hashrate mining with live BTC price appreciation modeling.

## Features

- **Live BTC Prices**: Fetches current and 2-year historical prices from CoinGecko API
- **Growth Scenarios**: Bear, Flat, Base, Historical (live), and Mega multipliers
- **Contract Scaling**: All scenarios scale proportionally to contract length
- **Difficulty Modeling**: 4% monthly difficulty growth factored in
- **Cost Breakdown**: Upfront + electricity costs with ROI calculation

## Deploy to Vercel

### Option 1: One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/mining-calculator)

### Option 2: Manual Deploy

1. Push this folder to a GitHub repository

2. Go to [vercel.com](https://vercel.com) and sign in

3. Click "New Project"

4. Import your GitHub repository

5. Vercel will auto-detect Next.js - click "Deploy"

### Option 3: Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

## Local Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

## Configuration

Edit `app/page.js` to customize:

- **Tier prices and hashrates** (lines 6-11)
- **Default electricity cost** (line 17)
- **Difficulty growth rate** (line 119)
- **S19 Pro efficiency** (line 18: 29.5 W/TH)

## API

Uses CoinGecko free API for BTC prices:
- Current price: `https://api.coingecko.com/api/v3/simple/price`
- Historical price: `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range`

Prices refresh every 12 hours (twice daily).

## License

MIT
