const express = require('express');
const { requireAuth, requirePlan } = require('../middleware/auth');
const { run, get, all } = require('../db/database');
const { chatWithAdvisor, simulateTrades } = require('../services/aiService');

const router = express.Router();
router.use(requireAuth);

// ── POST /ai/chat ─────────────────────────────────────────────
router.post('/chat', requirePlan('pro'), async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.json({ error: 'Message required' });

  try {
    const portfolio = await get(
      'SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1', [req.user.id]);
    if (!portfolio) return res.json({ error: 'No portfolio found' });

    const positions = await all(
      'SELECT * FROM positions WHERE portfolio_id = ? AND is_open = 1',
      [portfolio.id]
    );

    const history = await all(
      'SELECT role, content FROM ai_conversations WHERE user_id = ? ORDER BY created_at ASC LIMIT 20',
      [req.user.id]
    );

    const response = await chatWithAdvisor(portfolio, positions, history, message);

    // Save both sides of the conversation
    await run(
      'INSERT INTO ai_conversations (user_id, portfolio_id, role, content) VALUES (?,?,?,?)',
      [req.user.id, portfolio.id, 'user', message]
    );
    await run(
      'INSERT INTO ai_conversations (user_id, portfolio_id, role, content, tokens_used) VALUES (?,?,?,?,?)',
      [req.user.id, portfolio.id, 'assistant', response.content, response.tokens]
    );

    return res.json({ reply: response.content });
  } catch (err) {
    console.error('AI chat error:', err);
    return res.json({ error: 'AI advisor unavailable. Please try again.' });
  }
});

// ── POST /ai/simulate ─────────────────────────────────────────
router.post('/simulate', requirePlan('pro'), async (req, res) => {
  try {
    const portfolio = await get(
      'SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1', [req.user.id]);
    if (!portfolio) return res.json({ error: 'No portfolio found' });

    const positions = await all(
      'SELECT * FROM positions WHERE portfolio_id = ? AND is_open = 1',
      [portfolio.id]
    );

    const result = await simulateTrades(portfolio, positions);
    return res.json(result);
  } catch (err) {
    console.error('Simulate error:', err);
    return res.json({ error: 'Simulation failed.' });
  }
});

// ── GET /ai/history ───────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const history = await all(
      'SELECT role, content, created_at FROM ai_conversations WHERE user_id = ? ORDER BY created_at ASC LIMIT 50',
      [req.user.id]
    );
    res.json(history);
  } catch (err) {
    res.json([]);
  }
});

// ── DELETE /ai/history ────────────────────────────────────────
router.delete('/history', async (req, res) => {
  try {
    await run('DELETE FROM ai_conversations WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.json({ error: 'Could not clear history.' });
  }
});

module.exports = router;
