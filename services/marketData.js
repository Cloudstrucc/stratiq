/**
 * Stratiq Market Data Service
 * Fetches prices from Alpha Vantage with mock fallback for development
 */

const https = require('https');

// Mock prices for dev/testing when no API key is set
const MOCK_PRICES = {
  AAPL: { price: 189.30, change: 1.24,  name: 'Apple Inc.' },
  MSFT: { price: 415.72, change: 0.88,  name: 'Microsoft Corp.' },
  GOOGL:{ price: 175.50, change: -0.31, name: 'Alphabet Inc.' },
  AMZN: { price: 182.30, change: 1.55,  name: 'Amazon.com Inc.' },
  META: { price: 492.10, change: 2.10,  name: 'Meta Platforms' },
  NVDA: { price: 874.50, change: 3.17,  name: 'NVIDIA Corp.' },
  TSLA: { price: 171.05, change: -1.80, name: 'Tesla Inc.' },
  'BRK.B':{ price: 378.90, change: 0.45, name: 'Berkshire Hathaway B' },
  JPM:  { price: 197.20, change: 0.72,  name: 'JPMorgan Chase' },
  JNJ:  { price: 155.20, change: -0.40, name: 'Johnson & Johnson' },
  KO:   { price: 62.40,  change: 0.15,  name: 'Coca-Cola Co.' },
  BAC:  { price: 38.90,  change: -2.10, name: 'Bank of America' },
  PG:   { price: 165.80, change: 0.28,  name: 'Procter & Gamble' },
  V:    { price: 274.60, change: 0.90,  name: 'Visa Inc.' },
  MA:   { price: 455.30, change: 1.05,  name: 'Mastercard Inc.' },
  SPY:  { price: 528.10, change: -0.32, name: 'SPDR S&P 500 ETF' },
  QQQ:  { price: 447.20, change: 0.65,  name: 'Invesco QQQ Trust' },
  VTI:  { price: 245.80, change: -0.18, name: 'Vanguard Total Market' },
  BND:  { price: 73.40,  change: 0.05,  name: 'Vanguard Bond ETF' },
  GLD:  { price: 218.50, change: 0.42,  name: 'SPDR Gold Shares' },
  BTC:  { price: 67420,  change: 2.81,  name: 'Bitcoin' },
  ETH:  { price: 3580,   change: 1.95,  name: 'Ethereum' },
  SOL:  { price: 168.40, change: 3.50,  name: 'Solana' },
};

// ── Fetch single quote (Alpha Vantage) ───────────────────────
function fetchQuoteAV(symbol) {
  return new Promise((resolve, reject) => {
    const key = process.env.ALPHA_VANTAGE_KEY;
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${key}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json  = JSON.parse(data);
          const quote = json['Global Quote'];
          if (!quote || !quote['05. price']) return reject(new Error('No data'));
          resolve({
            symbol,
            price:  parseFloat(quote['05. price']),
            change: parseFloat(quote['10. change percent'].replace('%','')),
            name:   symbol,
          });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Get price for one symbol ──────────────────────────────────
async function getPrice(symbol) {
  const sym = symbol.toUpperCase();

  if (!process.env.ALPHA_VANTAGE_KEY) {
    // Dev mode: return mock with ±0.5% random drift
    const mock = MOCK_PRICES[sym];
    if (mock) {
      const drift = (Math.random() - 0.5) * 0.01;
      return { symbol: sym, price: +(mock.price * (1 + drift)).toFixed(2), change: mock.change + drift * 100, name: mock.name };
    }
    return { symbol: sym, price: 100, change: 0, name: sym };
  }

  try {
    return await fetchQuoteAV(sym);
  } catch {
    const mock = MOCK_PRICES[sym];
    return mock ? { symbol: sym, ...mock } : { symbol: sym, price: 100, change: 0, name: sym };
  }
}

// ── Update all positions in a portfolio ──────────────────────
async function updatePortfolioPrices(db, portfolioId) {
  const positions = await db.all(
    'SELECT id, symbol FROM positions WHERE portfolio_id = ? AND is_open = 1',
    [portfolioId]
  );

  const results = [];
  for (const pos of positions) {
    try {
      const data = await getPrice(pos.symbol);
      await db.run(
        'UPDATE positions SET current_price = ?, last_price_update = datetime(\'now\') WHERE id = ?',
        [data.price, pos.id]
      );
      results.push(data);
      // Rate limit: Alpha Vantage free = 5 req/min
      if (process.env.ALPHA_VANTAGE_KEY) {
        await new Promise(r => setTimeout(r, 13000));
      }
    } catch (err) {
      console.error(`Price update failed for ${pos.symbol}:`, err.message);
    }
  }
  return results;
}

// ── Calculate portfolio value ─────────────────────────────────
async function getPortfolioValue(db, portfolioId) {
  const portfolio = await db.get('SELECT cash_balance FROM portfolios WHERE id = ?', [portfolioId]);
  const positions = await db.all(
    'SELECT shares, current_price, avg_cost FROM positions WHERE portfolio_id = ? AND is_open = 1',
    [portfolioId]
  );
  const investedValue = positions.reduce((s, p) => s + p.shares * p.current_price, 0);
  const costBasis     = positions.reduce((s, p) => s + p.shares * p.avg_cost, 0);
  return {
    totalValue:    portfolio.cash_balance + investedValue,
    cashBalance:   portfolio.cash_balance,
    investedValue,
    costBasis,
    totalPnL:      investedValue - costBasis,
    totalPnLPct:   costBasis > 0 ? ((investedValue - costBasis) / costBasis * 100) : 0,
  };
}

module.exports = { getPrice, updatePortfolioPrices, getPortfolioValue, MOCK_PRICES };
