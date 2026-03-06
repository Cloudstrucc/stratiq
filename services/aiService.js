/**
 * Stratiq AI Service
 * Wraps Anthropic Claude for strategy simulation, trade decisions & report generation
 */

const Anthropic = require('@anthropic-ai/sdk');

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// ── Strategy definitions ──────────────────────────────────────
const STRATEGIES = {
  buffett: {
    name: 'Warren Buffett',
    system: `You are simulating Warren Buffett's value investing strategy.
Rules: Buy wonderful companies at fair prices. Look for P/E < 20, ROE > 15%, 
low debt-to-equity < 0.5, durable competitive moats, strong free cash flow,
and a minimum 10-year operating history. Hold forever unless fundamentals deteriorate.
Never invest in what you don't understand. Keep 5-10% cash for opportunities.`,
  },
  dalio: {
    name: 'Ray Dalio',
    system: `You are simulating Ray Dalio's All Weather portfolio strategy.
Rules: 30% US Stocks, 40% Long-term Bonds, 15% Intermediate Bonds, 7.5% Gold, 7.5% Commodities.
Rebalance quarterly. The goal is to perform well in all economic environments (growth, recession, inflation, deflation).`,
  },
  lynch: {
    name: 'Peter Lynch',
    system: `You are simulating Peter Lynch's GARP (Growth At a Reasonable Price) strategy.
Rules: PEG ratio < 1. Invest in what you know. Look for companies growing 20-25% annually
at reasonable valuations. Prefer small/mid-caps with room to grow. Diversify across 
categories: stalwarts, fast growers, turnarounds, asset plays.`,
  },
  wood: {
    name: 'Cathie Wood',
    system: `You are simulating Cathie Wood's innovation-focused strategy.
Rules: Focus on disruptive technologies — AI, genomics, fintech, autonomous vehicles, space.
High conviction, concentrated positions. 5-year+ time horizon. Embrace volatility.
Target stocks with potential for 15x+ returns over 5 years. Weight by conviction level.`,
  },
  livermore: {
    name: 'Jesse Livermore',
    system: `You are simulating Jesse Livermore's momentum and trend-following strategy.
Rules: Trade with the trend. Buy breakouts at all-time highs. Cut losses quickly at 10%.
Never average down. Pyramiding into winning positions. Sit on your hands during consolidations.
Cash is a position. Never fight the tape.`,
  },
  dca_index: {
    name: 'DCA Index',
    system: `You are simulating a passive Dollar-Cost Averaging index strategy.
Rules: Invest a fixed amount into SPY (S&P 500) and QQQ (Nasdaq) weekly regardless of price.
80% SPY / 20% QQQ. Reinvest all dividends. Never sell. This is the most tax-efficient long-term strategy.`,
  },
  manual: {
    name: 'Manual Portfolio',
    system: `You are a helpful portfolio advisor reviewing a manually constructed portfolio.
Provide analysis, suggestions, and risk assessment based on the current holdings.`,
  },
};

// ── Simulate AI trades ────────────────────────────────────────
async function simulateTrades(portfolio, positions, marketData = []) {
  const strategy = STRATEGIES[portfolio.strategy_key] || STRATEGIES.manual;
  const customPrompt = portfolio.strategy_prompt
    ? `\nAdditional user instructions: ${portfolio.strategy_prompt}`
    : '';

  const systemPrompt = `${strategy.system}${customPrompt}

You are managing a simulated portfolio. Respond ONLY with a valid JSON object.
No markdown, no explanation outside the JSON.

Response format:
{
  "trades": [
    {
      "symbol": "AAPL",
      "action": "buy|sell|hold",
      "shares": 10,
      "reason": "Brief reason (max 100 chars)",
      "conviction": "high|medium|low"
    }
  ],
  "summary": "2-3 sentence overall portfolio commentary",
  "market_context": "1-2 sentence market observation",
  "health_score": 85
}`;

  const userMessage = `
Portfolio Overview:
- Strategy: ${strategy.name}
- Risk Level: ${portfolio.risk_level}
- Initial Budget: $${portfolio.initial_budget.toLocaleString()}
- Cash Balance: $${portfolio.cash_balance.toLocaleString()}
- Rebalance Frequency: ${portfolio.rebalance_freq}

Current Positions:
${positions.map(p =>
  `${p.symbol} (${p.asset_type}): ${p.shares} shares @ $${p.current_price} | Avg cost: $${p.avg_cost} | P&L: $${((p.current_price - p.avg_cost) * p.shares).toFixed(2)}`
).join('\n') || 'No positions yet — this is a new portfolio.'}

${marketData.length ? `Recent Market Data:\n${marketData.map(m => `${m.symbol}: $${m.price} (${m.change}%)`).join('\n')}` : ''}

Based on the ${strategy.name} strategy, what trades should I make today? If no trades are needed, return an empty trades array.
`;

  try {
    const response = await getClient().messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('AI trade simulation error:', err.message);
    return {
      trades: [],
      summary: 'AI advisor unavailable. Holding all positions.',
      market_context: '',
      health_score: 75,
    };
  }
}

// ── Daily report AI summary ───────────────────────────────────
async function generateDailySummary(user, portfolio, positions, todayTrades, pnl) {
  const strategy = STRATEGIES[portfolio.strategy_key] || STRATEGIES.manual;

  const prompt = `Generate a concise daily investment report for a ${strategy.name} portfolio simulation.

User: ${user.first_name} ${user.last_name}
Strategy: ${strategy.name}
Risk Level: ${portfolio.risk_level}
Portfolio Value: $${(portfolio.cash_balance + positions.reduce((s, p) => s + p.current_price * p.shares, 0)).toLocaleString()}
Today's P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}
Positions: ${positions.length}
Trades Today: ${todayTrades.length}

Top positions: ${positions.slice(0, 5).map(p => `${p.symbol} (${((p.current_price - p.avg_cost) / p.avg_cost * 100).toFixed(1)}%)`).join(', ')}

Write a friendly, professional 3-4 paragraph summary covering:
1. Portfolio performance today
2. Key positions to watch
3. Strategy alignment check
4. One actionable insight

Keep it concise, insightful, and encouraging. No markdown headers. Plain paragraphs.`;

  try {
    const response = await getClient().messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content[0]?.text || 'Summary unavailable.';
  } catch (err) {
    console.error('AI summary error:', err.message);
    return 'Your portfolio performed in line with expectations today. Check the dashboard for detailed metrics.';
  }
}

// ── Chat with strategy advisor ────────────────────────────────
async function chatWithAdvisor(portfolio, positions, conversationHistory, userMessage) {
  const strategy = STRATEGIES[portfolio.strategy_key] || STRATEGIES.manual;

  const systemPrompt = `You are a knowledgeable investment advisor simulating the ${strategy.name} investment philosophy.
You are helping a user understand and improve their simulated portfolio.
${strategy.system}

Important: This is a SIMULATION only. Never give real financial advice.
Always remind the user this is for educational/simulation purposes.
Be concise, clear, and educational. Use specific numbers from their portfolio when relevant.`;

  const messages = [
    ...conversationHistory.slice(-10).map(m => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content: `My portfolio context:
- Strategy: ${strategy.name} | Risk: ${portfolio.risk_level}
- Cash: $${portfolio.cash_balance.toLocaleString()}
- Positions: ${positions.slice(0, 8).map(p => p.symbol).join(', ')}

My question: ${userMessage}`,
    },
  ];

  try {
    const response = await getClient().messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 800,
      system: systemPrompt,
      messages,
    });
    return {
      content: response.content[0]?.text || 'I could not process your request.',
      tokens: response.usage?.input_tokens + response.usage?.output_tokens || 0,
    };
  } catch (err) {
    console.error('AI chat error:', err.message);
    return { content: 'AI advisor is temporarily unavailable. Please try again.', tokens: 0 };
  }
}

module.exports = { simulateTrades, generateDailySummary, chatWithAdvisor, STRATEGIES };
