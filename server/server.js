'use strict';

const express = require('express');
const { loadConfig } = require('./config-loader');
const persistence = require('./persistence');
const lockManager = require('./lock-manager');
const cliqNotifier = require('./cliq-notifier');

// ── Bootstrap ──────────────────────────────────────────────────────────────
const config = loadConfig();
persistence.initFiles();

// No WebSocket in bot-only mode — broadcast is a no-op
lockManager.setBroadcastFn(() => {});
lockManager.setCliqNotifier(cliqNotifier);
lockManager.resumeTimerOnStartup();

const app = express();
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  const user = req.body?.user?.email || req.body?.user?.name || '-';
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} user=${user}`);
  next();
});

// ── Health / Git hook status ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ service: 'commit-lock-bot', status: 'running' });
});

app.get('/status', (req, res) => {
  res.json(lockManager.getStatus());
});

// ── Cliq slash command handlers ────────────────────────────────────────────
// Zoho Cliq URL-type slash command POST body:
//   { user: { name, email }, command: { arguments: "text after command" } }
// Response must be a Cliq message/card JSON.

// /checkin [optional commit message]
app.post('/cliq/checkin', async (req, res) => {
  const username = extractUser(req.body);
  const commitMessage = (req.body?.command?.arguments || '').trim() || null;
  const result = await lockManager.acquireLock(username, commitMessage);
  res.json(cliqNotifier.buildAcquireResponse(result, username));
});

// /checkout
app.post('/cliq/checkout', (req, res) => {
  const username = extractUser(req.body);
  const result = lockManager.releaseLock(username, false);
  res.json(cliqNotifier.buildReleaseResponse(result, username));
});

// /lockstatus
app.post('/cliq/status', (req, res) => {
  res.json(cliqNotifier.buildStatusCard(lockManager.getStatus()));
});

// /forcerelease <admin-key>
app.post('/cliq/force', (req, res) => {
  const username = extractUser(req.body);
  const adminKey = (req.body?.command?.arguments || '').trim();

  if (!adminKey || adminKey !== config.adminKey) {
    return res.json({ text: '❌ Invalid admin key. Usage: `/forcerelease your-admin-key`' });
  }

  const state = lockManager.getStatus();
  if (!state.locked) {
    return res.json({ text: 'ℹ️ No lock is currently held.' });
  }

  const result = lockManager.releaseLock(state.holder, true);
  res.json({
    text: result.success
      ? `✅ Lock force-released from *${state.holder}* by ${username}.`
      : `❌ ${result.message}`
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────
// Prefer email (unique across org), fall back to display name.
function extractUser(body) {
  return body?.user?.email || body?.user?.name || 'unknown';
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
process.on('SIGTERM', () => { console.log('Shutting down.'); process.exit(0); });
process.on('SIGINT',  () => { console.log('Shutting down.'); process.exit(0); });

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || config.port || 3000;
app.listen(PORT, () => {
  console.log(`\nCommit Lock Bot running on port ${PORT}`);
  console.log('\nSlash command endpoints:');
  console.log('  POST /cliq/checkin   →  /checkin [commit message]');
  console.log('  POST /cliq/checkout  →  /checkout');
  console.log('  POST /cliq/status    →  /lockstatus');
  console.log('  POST /cliq/force     →  /forcerelease <admin-key>');
  console.log('\nGit hook endpoint:');
  console.log('  GET  /status');
  console.log('');
});
