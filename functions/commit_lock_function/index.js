'use strict';

// Zoho Catalyst Advanced I/O Function
// Handles all Zoho Cliq slash commands for the commit lock bot.
// State is stored in Catalyst DataStore (no persistent server needed).

const express = require('express');
const catalyst = require('zcatalyst-sdk-node');
const lockStore = require('./lock-store');
const cliq = require('./cliq');

const app = express();
app.use(express.json());

// ── Health / Git hook endpoint ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ service: 'commit-lock-bot', status: 'running' });
});

app.get('/status', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const status = await lockStore.getStatus(catalystApp);
    // Send timeout-release notification if it just expired
    if (status._autoReleasedHolder) {
      cliq.notifyTimeoutRelease(status._autoReleasedHolder);
    }
    const { _autoReleasedHolder, ...publicStatus } = status;
    res.json(publicStatus);
  } catch (err) {
    console.error('/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Cliq slash command endpoints ───────────────────────────────────────────
// Zoho Cliq URL-type slash command POST body:
//   { user: { name, email }, command: { arguments: "text after command" } }

// /checkin [optional commit message]
app.post('/cliq/checkin', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const username = extractUser(req.body);
    const commitMessage = (req.body?.command?.arguments || '').trim() || null;

    const result = await lockStore.acquireLock(catalystApp, username, commitMessage);
    if (result.success) cliq.notifyAcquired(username, commitMessage);

    res.json(cliq.acquireResponse(result, username));
  } catch (err) {
    console.error('/cliq/checkin error:', err.message);
    res.json({ text: `❌ Error: ${err.message}` });
  }
});

// /checkout
app.post('/cliq/checkout', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const username = extractUser(req.body);

    const result = await lockStore.releaseLock(catalystApp, username, false);
    if (result.success) cliq.notifyReleased(username, result.durationMinutes, result.nextInQueue);

    res.json(cliq.releaseResponse(result, username));
  } catch (err) {
    console.error('/cliq/checkout error:', err.message);
    res.json({ text: `❌ Error: ${err.message}` });
  }
});

// /lockstatus
app.post('/cliq/status', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const status = await lockStore.getStatus(catalystApp);
    if (status._autoReleasedHolder) cliq.notifyTimeoutRelease(status._autoReleasedHolder);
    res.json(cliq.statusCard(status));
  } catch (err) {
    console.error('/cliq/status error:', err.message);
    res.json({ text: `❌ Error: ${err.message}` });
  }
});

// /forcerelease <admin-key>
app.post('/cliq/force', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const username = extractUser(req.body);
    const adminKey = (req.body?.command?.arguments || '').trim();
    const expectedKey = process.env.ADMIN_KEY || '';

    if (!adminKey || adminKey !== expectedKey) {
      return res.json({ text: '❌ Invalid admin key. Usage: `/forcerelease your-admin-key`' });
    }

    const status = await lockStore.getStatus(catalystApp);
    if (!status.locked) return res.json({ text: 'ℹ️ No lock is currently held.' });

    const result = await lockStore.releaseLock(catalystApp, status.holder, true);
    if (result.success) cliq.notifyReleased(status.holder, result.durationMinutes, result.nextInQueue);

    res.json({
      text: result.success
        ? `✅ Force-released lock from *${status.holder}* by ${username}.`
        : `❌ ${result.message}`
    });
  } catch (err) {
    console.error('/cliq/force error:', err.message);
    res.json({ text: `❌ Error: ${err.message}` });
  }
});

// ── Helper ─────────────────────────────────────────────────────────────────
function extractUser(body) {
  return body?.user?.email || body?.user?.name || 'unknown';
}

module.exports = app;
