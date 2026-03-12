'use strict';

// Zoho Cliq integration helpers.
// - Outbound: sends channel notifications via CLIQ_NOTIFY_URL webhook (fire-and-forget)
// - Inbound: builds response JSON for Cliq slash commands
//
// Environment variables:
//   CLIQ_NOTIFY_URL  — webhook URL for channel notifications (optional; skips if absent)
//
// Cliq slash command response format: { text: "..." }
// Rich card format (used for /lockstatus):
//   { text, card: { title, theme }, slides: [...] }

const NOTIFY_URL = () => process.env.CLIQ_NOTIFY_URL || '';

// ── Outbound webhook (non-throwing) ───────────────────────────────────────

async function sendWebhook(payload) {
  const url = NOTIFY_URL();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('[cliq] webhook send failed (non-fatal):', err.message);
  }
}

function notifyAcquired(username, commitMessage) {
  const msg = commitMessage ? `\`${commitMessage}\`` : '_no message_';
  sendWebhook({
    text: `🔴 *Lock ACQUIRED* by *${username}*\nCommit message: ${msg}\nUse \`/checkout\` when done.`
  });
}

function notifyReleased(username, durationMinutes, nextInQueue) {
  const dur = durationMinutes != null ? ` after ${durationMinutes} min` : '';
  let text = `✅ *Lock RELEASED* by *${username}*${dur}.`;
  if (nextInQueue) {
    text += `\n👉 *${nextInQueue}* — you're next! Run \`/checkin\` when ready.`;
  }
  sendWebhook({ text });
}

function notifyTimeoutRelease(username) {
  sendWebhook({
    text: `⏱️ Lock held by *${username}* was *auto-released* due to inactivity timeout.`
  });
}

// ── Slash command response builders ───────────────────────────────────────

/**
 * Response for /checkin
 * result: { success, error?, holder?, queuePosition?, message? }
 */
function acquireResponse(result, username) {
  if (result.success) {
    return { text: `🔴 You now hold the *commit lock*, ${username}. Run \`/checkout\` when done committing.` };
  }
  switch (result.error) {
    case 'you_already_hold_lock':
      return { text: `ℹ️ You already hold the commit lock, ${username}.` };
    case 'locked_by_other':
      return {
        text: `🔒 Lock is held by *${result.holder}*. You are *#${result.queuePosition}* in the queue.\nYou'll be notified when it's your turn.`
      };
    case 'missing_user':
      return { text: `❌ ${result.message}` };
    default:
      return { text: `❌ ${result.message || 'Could not acquire lock.'}` };
  }
}

/**
 * Response for /checkout
 * result: { success, error?, durationMinutes?, nextInQueue?, message? }
 */
function releaseResponse(result, username) {
  if (result.success) {
    const dur = result.durationMinutes != null ? ` (held for ${result.durationMinutes} min)` : '';
    let text = `✅ Lock released by *${username}*${dur}.`;
    if (result.nextInQueue) {
      text += ` *${result.nextInQueue}* is next in queue.`;
    }
    return { text };
  }
  switch (result.error) {
    case 'not_locked':
      return { text: 'ℹ️ No lock is currently held.' };
    case 'not_your_lock':
      return { text: `❌ ${result.message}` };
    default:
      return { text: `❌ ${result.message || 'Could not release lock.'}` };
  }
}

/**
 * Rich card response for /lockstatus
 * status: full object from lockStore.getStatus()
 */
function statusCard(status) {
  if (!status.locked) {
    return {
      text: '🟢 *Commit lock is FREE* — use `/checkin` to acquire it.'
    };
  }

  const queueList = (status.queue || []).length > 0
    ? status.queue.map((q, i) => `${i + 1}. ${q.user}`).join('\n')
    : 'Nobody waiting';

  const timeoutAt = status.since
    ? new Date(new Date(status.since).getTime() + status.lockTimeoutMinutes * 60000).toISOString()
    : 'N/A';

  return {
    text: '🔴 *Commit lock is HELD*',
    card: { title: 'Commit Lock Status', theme: 'modern-inline' },
    slides: [
      {
        type: 'table',
        data: {
          headers: ['Field', 'Value'],
          rows: [
            ['Held by', status.holder || ''],
            ['Since', status.since ? new Date(status.since).toLocaleString() : ''],
            ['Commit message', status.commitMessage || '—'],
            ['Time held', `${status.timeHeldMinutes} min`],
            ['Auto-releases in', `${status.timeRemainingMinutes} min (at ${timeoutAt})`]
          ]
        }
      },
      {
        type: 'text',
        data: { text: `*Queue:*\n${queueList}` }
      }
    ]
  };
}

module.exports = {
  notifyAcquired,
  notifyReleased,
  notifyTimeoutRelease,
  acquireResponse,
  releaseResponse,
  statusCard
};
