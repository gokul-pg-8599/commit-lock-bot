'use strict';

// Lock state stored as a single row in Catalyst DataStore.
// No persistent server or JSON file needed — works fully serverless.
//
// DataStore table: CommitLock
// Columns: locked, holder, since, commitMessage, queue, lastActivity
// (All columns are String type in DataStore; booleans stored as "true"/"false")

const TABLE_NAME = 'CommitLock';

const DEFAULT_STATE = {
  locked: false,
  holder: null,
  since: null,
  commitMessage: null,
  queue: [],
  lastActivity: null
};

// ── DataStore read/write ───────────────────────────────────────────────────

async function readRow(app) {
  try {
    const rows = await app.datastore().table(TABLE_NAME).getRows();
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      ROWID: r.ROWID,
      locked: r.locked === 'true',
      holder: r.holder || null,
      since: r.since || null,
      commitMessage: r.commitMessage || null,
      queue: r.queue ? JSON.parse(r.queue) : [],
      lastActivity: r.lastActivity || null
    };
  } catch (err) {
    console.error('[lock-store] readRow failed:', err.message);
    return null;
  }
}

async function writeRow(app, state) {
  const table = app.datastore().table(TABLE_NAME);
  const rowData = {
    locked: String(state.locked),
    holder: state.holder || '',
    since: state.since || '',
    commitMessage: state.commitMessage || '',
    queue: JSON.stringify(state.queue || []),
    lastActivity: state.lastActivity || ''
  };
  if (state.ROWID) {
    return table.updateRow({ ...rowData, ROWID: state.ROWID });
  } else {
    return table.insertRow(rowData);
  }
}

// ── Timeout check (replaces setTimeout — works serverless) ─────────────────

function checkExpired(state) {
  const timeoutMin = parseInt(process.env.LOCK_TIMEOUT_MINUTES || '30');
  if (!state.locked || !state.lastActivity) return false;
  const elapsedMin = (Date.now() - new Date(state.lastActivity).getTime()) / 60000;
  return elapsedMin > timeoutMin;
}

// ── Public API ─────────────────────────────────────────────────────────────

async function getStatus(app) {
  const timeoutMin = parseInt(process.env.LOCK_TIMEOUT_MINUTES || '30');
  const state = (await readRow(app)) || { ...DEFAULT_STATE };

  let autoReleasedHolder = null;

  // Auto-release expired lock on every read (no server-side timer needed)
  if (checkExpired(state)) {
    autoReleasedHolder = state.holder;
    state.locked = false;
    state.holder = null;
    state.since = null;
    state.commitMessage = null;
    state.lastActivity = new Date().toISOString();
    await writeRow(app, state);
  }

  let timeHeldMin = 0;
  let timeRemainingMin = timeoutMin;
  if (state.locked && state.since) {
    timeHeldMin = (Date.now() - new Date(state.since).getTime()) / 60000;
    timeRemainingMin = Math.max(0, timeoutMin - timeHeldMin);
  }

  return {
    locked: state.locked,
    holder: state.holder,
    since: state.since,
    commitMessage: state.commitMessage,
    queue: state.queue || [],
    lastActivity: state.lastActivity,
    timeHeldMinutes: parseFloat(timeHeldMin.toFixed(2)),
    timeRemainingMinutes: parseFloat(timeRemainingMin.toFixed(2)),
    lockTimeoutMinutes: timeoutMin,
    _autoReleasedHolder: autoReleasedHolder  // stripped before sending to client
  };
}

async function acquireLock(app, username, commitMessage) {
  if (!username || username === 'unknown') {
    return { success: false, error: 'missing_user', message: 'Could not identify user from Cliq.' };
  }

  const state = (await readRow(app)) || { ...DEFAULT_STATE };
  const now = new Date().toISOString();

  // Treat expired lock as free
  if (checkExpired(state)) {
    state.locked = false;
    state.holder = null;
    state.since = null;
    state.commitMessage = null;
  }

  if (state.locked && state.holder === username) {
    return { success: false, error: 'you_already_hold_lock', message: 'You already hold the lock.' };
  }

  if (state.locked) {
    // Add to queue if not already there
    if (!state.queue) state.queue = [];
    if (!state.queue.some(q => q.user === username)) {
      state.queue.push({ user: username, requestedAt: now });
      await writeRow(app, state);
    }
    const pos = state.queue.findIndex(q => q.user === username) + 1;
    return {
      success: false,
      error: 'locked_by_other',
      holder: state.holder,
      queuePosition: pos,
      message: `Lock held by ${state.holder}. You are #${pos} in queue.`
    };
  }

  // Free — acquire it
  state.locked = true;
  state.holder = username;
  state.since = now;
  state.commitMessage = commitMessage || null;
  state.lastActivity = now;
  state.queue = (state.queue || []).filter(q => q.user !== username);
  await writeRow(app, state);

  return { success: true };
}

async function releaseLock(app, username, forced) {
  const state = await readRow(app);

  if (!state || !state.locked) {
    return { success: false, error: 'not_locked', message: 'No lock is currently held.' };
  }

  if (state.holder !== username && !forced) {
    return { success: false, error: 'not_your_lock', message: `Lock is held by ${state.holder}, not you.` };
  }

  const durationMinutes = state.since
    ? parseFloat(((Date.now() - new Date(state.since).getTime()) / 60000).toFixed(2))
    : 0;

  const nextInQueue = state.queue?.[0]?.user || null;
  const releasedHolder = state.holder;

  state.locked = false;
  state.holder = null;
  state.since = null;
  state.commitMessage = null;
  state.lastActivity = new Date().toISOString();
  // Keep queue intact — next person runs /checkin themselves
  await writeRow(app, state);

  return { success: true, durationMinutes, nextInQueue, releasedHolder };
}

module.exports = { getStatus, acquireLock, releaseLock };
