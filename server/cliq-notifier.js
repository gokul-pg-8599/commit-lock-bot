'use strict';

const { getConfig } = require('./config-loader');

const FETCH_TIMEOUT_MS = 5000;

async function sendWebhook(payload) {
  const config = getConfig();
  if (!config.cliqEnabled || !config.cliqNotifyUrl) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    await fetch(config.cliqNotifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    // Never throw — lock system must work even if Cliq is unreachable
    console.warn('[cliq] Notification failed (non-fatal):', err.message);
  } finally {
    clearTimeout(timer);
  }
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function notifyAcquired(username, commitMessage) {
  const msg = commitMessage ? `  Message: _${commitMessage}_` : '';
  return sendWebhook({
    text: `🔴 *Commit Lock ACQUIRED* by *${username}*\n${msg}\n_Auto-releases in ${getConfig().lockTimeoutMinutes} min if not checked out._`
  });
}

function notifyReleased(username, durationMinutes, nextInQueue) {
  const next = nextInQueue ? `\n➡️ Next up: *${nextInQueue}* — run \`/checkin\`` : '\nLock is now free.';
  return sendWebhook({
    text: `🟢 *Commit Lock RELEASED* by *${username}* _(held ${durationMinutes.toFixed(1)} min)_${next}`
  });
}

function notifyTimeoutRelease(username) {
  const config = getConfig();
  const payload = {
    text: `⏰ *Commit Lock AUTO-RELEASED* — ${username}'s lock expired after ${config.lockTimeoutMinutes} minutes of inactivity.`,
    card: {
      title: 'Commit Lock — Timeout',
      theme: 'modern-inline'
    }
  };
  return sendWebhook(payload);
}

function notifyQueueUpdate(queue) {
  if (!queue || queue.length === 0) return;
  const queueStr = queue.map((q, i) => `${i + 1}. ${q.user}`).join('\n');
  const payload = {
    text: `📋 *Commit Lock Queue Updated*\n${queueStr}`
  };
  return sendWebhook(payload);
}

// Slash command response: /lockstatus
function buildStatusCard(lockStatus) {
  if (!lockStatus.locked) {
    const queueLine = lockStatus.queue.length > 0
      ? `\nQueue: ${lockStatus.queue.map(q => q.user).join(' → ')}`
      : '';
    return { text: `🟢 *Commit Lock is AVAILABLE*${queueLine}\nRun \`/checkin\` to acquire it.` };
  }

  const msg = lockStatus.commitMessage ? `\n  Message: _${lockStatus.commitMessage}_` : '';
  const queue = lockStatus.queue.length > 0
    ? `\nQueue: ${lockStatus.queue.map((q, i) => `${i + 1}. ${q.user}`).join(', ')}`
    : '';

  return {
    text: `🔴 *Commit Lock LOCKED* by *${lockStatus.holder}*${msg}\n  Held for: ${lockStatus.timeHeldMinutes.toFixed(1)} min  |  Auto-release in: ${lockStatus.timeRemainingMinutes.toFixed(1)} min${queue}`
  };
}

function buildAcquireResponse(result, username) {
  if (result.success) {
    return {
      text: `✅ Lock acquired by *${username}*! Remember to /checkout when done.`
    };
  }
  if (result.error === 'locked_by_other') {
    return {
      text: `❌ Lock is held by *${result.holder}*. You are #${result.queuePosition} in queue.`
    };
  }
  if (result.error === 'you_already_hold_lock') {
    return { text: `ℹ️ You already hold the lock, ${username}.` };
  }
  return { text: `❌ Could not acquire lock: ${result.message}` };
}

function buildReleaseResponse(result, username) {
  if (result.success) {
    return { text: `✅ Lock released by *${username}*. Held for ${result.durationMinutes.toFixed(1)} min.` };
  }
  return { text: `❌ Could not release: ${result.message}` };
}

module.exports = {
  notifyAcquired,
  notifyReleased,
  notifyTimeoutRelease,
  notifyQueueUpdate,
  buildStatusCard,
  buildAcquireResponse,
  buildReleaseResponse
};
