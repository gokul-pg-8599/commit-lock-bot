'use strict';

const { getConfig } = require('./config-loader');
const persistence = require('./persistence');

// Filled in by server.js after initialization to avoid circular dependency
let broadcastFn = null;
let cliqNotifier = null;

// Mutex to prevent race conditions on simultaneous acquire requests
let isProcessing = false;

// Active auto-release timeout handle
let activeTimer = null;

function setBroadcastFn(fn) {
  broadcastFn = fn;
}

function setCliqNotifier(notifier) {
  cliqNotifier = notifier;
}

function broadcast(state) {
  if (broadcastFn) broadcastFn(state);
}

function getStatus() {
  const config = getConfig();
  const state = persistence.readState();

  let timeHeldMinutes = 0;
  let timeRemainingMinutes = config.lockTimeoutMinutes;

  if (state.locked && state.since) {
    timeHeldMinutes = (Date.now() - new Date(state.since).getTime()) / 60000;
    timeRemainingMinutes = Math.max(0, config.lockTimeoutMinutes - timeHeldMinutes);
  }

  return {
    ...state,
    timeHeldMinutes: parseFloat(timeHeldMinutes.toFixed(2)),
    timeRemainingMinutes: parseFloat(timeRemainingMinutes.toFixed(2)),
    lockTimeoutMinutes: config.lockTimeoutMinutes
  };
}

function acquireLock(username, commitMessage) {
  return new Promise((resolve) => {
    // Mutex: if another request is being processed, defer to next tick
    if (isProcessing) {
      setImmediate(() => acquireLock(username, commitMessage).then(resolve));
      return;
    }
    isProcessing = true;

    try {
      if (!username || username === 'unknown') {
        isProcessing = false;
        return resolve({ success: false, error: 'missing_user', message: 'Could not identify user from Cliq request.' });
      }

      const state = persistence.readState();

      // Already holding the lock yourself
      if (state.locked && state.holder === username) {
        isProcessing = false;
        return resolve({
          success: false,
          error: 'you_already_hold_lock',
          message: 'You already hold the commit lock.',
          state: getStatus()
        });
      }

      // Locked by someone else — add to queue
      if (state.locked && state.holder !== username) {
        const alreadyQueued = state.queue.some(q => q.user === username);
        if (!alreadyQueued) {
          state.queue.push({ user: username, requestedAt: new Date().toISOString() });
          persistence.writeState(state);
          broadcast(getStatus());
          // No queue notification — the /checkin response already tells the user their position
        }
        isProcessing = false;
        return resolve({
          success: false,
          error: 'locked_by_other',
          message: `Lock is held by ${state.holder}. You are now in the queue.`,
          holder: state.holder,
          queuePosition: state.queue.findIndex(q => q.user === username) + 1,
          state: getStatus()
        });
      }

      // Lock is free — acquire it
      const now = new Date().toISOString();
      state.locked = true;
      state.holder = username;
      state.since = now;
      state.commitMessage = commitMessage || null;
      state.lastActivity = now;
      // Remove from queue in case they were waiting
      state.queue = state.queue.filter(q => q.user !== username);

      persistence.writeState(state);
      persistence.appendHistory({
        event: 'acquired',
        user: username,
        commitMessage: commitMessage || null,
        timestamp: now,
        duration: null
      });

      startTimeoutTimer(username, getConfig().lockTimeoutMinutes);
      broadcast(getStatus());

      if (cliqNotifier) cliqNotifier.notifyAcquired(username, commitMessage);

      isProcessing = false;
      return resolve({ success: true, state: getStatus() });

    } catch (err) {
      isProcessing = false;
      console.error('ERROR in acquireLock:', err);
      return resolve({ success: false, error: 'internal_error', message: err.message });
    }
  });
}

function releaseLock(username, forced = false) {
  const state = persistence.readState();
  const now = new Date().toISOString();

  if (!state.locked) {
    return { success: false, error: 'not_locked', message: 'No lock is currently held.' };
  }

  if (state.holder !== username && !forced) {
    return {
      success: false,
      error: 'not_your_lock',
      message: `Lock is held by ${state.holder}, not ${username}.`
    };
  }

  const durationMinutes = state.since
    ? parseFloat(((Date.now() - new Date(state.since).getTime()) / 60000).toFixed(2))
    : 0;

  const releasedBy = state.holder;
  const nextInQueue = state.queue.length > 0 ? state.queue[0].user : null;

  state.locked = false;
  state.holder = null;
  state.since = null;
  state.commitMessage = null;
  state.lastActivity = now;
  // Keep queue intact — next person must click Check In themselves

  persistence.writeState(state);
  persistence.appendHistory({
    event: forced ? 'force_released' : 'released',
    user: releasedBy,
    releasedBy: forced ? username : releasedBy,
    commitMessage: null,
    timestamp: now,
    duration: durationMinutes
  });

  clearTimeoutTimer();
  broadcast(getStatus());

  if (cliqNotifier) cliqNotifier.notifyReleased(releasedBy, durationMinutes, nextInQueue);

  return { success: true, state: getStatus(), durationMinutes };
}

function leaveQueue(username) {
  const state = persistence.readState();
  const before = state.queue.length;
  state.queue = state.queue.filter(q => q.user !== username);

  if (state.queue.length !== before) {
    persistence.writeState(state);
    broadcast(getStatus());
  }

  return { success: true, state: getStatus() };
}

function heartbeat(username) {
  const config = getConfig();
  const state = persistence.readState();

  if (!state.locked || state.holder !== username) {
    return { success: false, error: 'not_lock_holder' };
  }

  state.lastActivity = new Date().toISOString();
  persistence.writeState(state);

  // Reset the rolling timeout timer
  startTimeoutTimer(username, config.lockTimeoutMinutes);

  return { success: true };
}

function startTimeoutTimer(username, minutes) {
  clearTimeoutTimer();
  const config = getConfig();
  if (!config.autoReleaseOnTimeout) return;

  activeTimer = setTimeout(() => {
    console.log(`[commit-lock] Auto-releasing lock held by ${username} due to timeout.`);
    const result = releaseLock(username, true);
    if (result.success && cliqNotifier) {
      cliqNotifier.notifyTimeoutRelease(username);
    }
  }, minutes * 60 * 1000);
}

function clearTimeoutTimer() {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
}

function resumeTimerOnStartup() {
  const config = getConfig();
  const state = persistence.readState();

  if (!state.locked || !state.holder || !state.since) return;

  const elapsedMinutes = (Date.now() - new Date(state.since).getTime()) / 60000;
  const remainingMinutes = config.lockTimeoutMinutes - elapsedMinutes;

  if (remainingMinutes <= 0) {
    console.log(`[commit-lock] Lock held by ${state.holder} already expired during downtime. Auto-releasing.`);
    releaseLock(state.holder, true);
  } else {
    console.log(`[commit-lock] Resuming timeout timer for ${state.holder} — ${remainingMinutes.toFixed(1)} min remaining.`);
    startTimeoutTimer(state.holder, remainingMinutes);
  }
}

function getHistory(limit = 50) {
  return persistence.readHistory(limit);
}

module.exports = {
  setBroadcastFn,
  setCliqNotifier,
  getStatus,
  acquireLock,
  releaseLock,
  leaveQueue,
  heartbeat,
  resumeTimerOnStartup,
  getHistory
};
