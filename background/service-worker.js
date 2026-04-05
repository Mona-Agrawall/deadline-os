// background/service-worker.js

importScripts('/utils/date-utils.js');
importScripts('/background/parser.js');
importScripts('/background/scorer.js');
importScripts('/background/deduplicator.js');
importScripts('/background/storage.js');
importScripts('/background/calendar.js');
importScripts('/background/gmail-scanner.js');
importScripts('/background/notifier.js');

console.log('[DeadlineOS] Service worker started.');

// ── Polling alarm name ─────────────────────────────────────────────
const POLL_ALARM = 'deadlineos-poll';
const CLEANUP_ALARM = 'deadlineos-cleanup';
const RETRY_ALARM = 'deadlineos-retry';
const POLL_INTERVAL_MINUTES = 30;

// ── Lifecycle events ───────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[DeadlineOS] Extension installed/updated:', details.reason);
  setupAlarms();
  Notifier.rescheduleAll();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[DeadlineOS] Browser started.');
  setupAlarms();
  Notifier.rescheduleAll();
  // Run a scan on startup after a short delay
  setTimeout(() => {
    GmailScanner.scanInbox().catch(e => {
      console.log('[DeadlineOS] Startup scan skipped:', e.message);
    });
  }, 5000);
});

function setupAlarms() {
  // Polling alarm: scan Gmail every 30 minutes
  chrome.alarms.create(POLL_ALARM, {
    delayInMinutes: 1, // First poll 1 min after startup
    periodInMinutes: POLL_INTERVAL_MINUTES,
  });
  console.log(`[DeadlineOS] Poll alarm set: every ${POLL_INTERVAL_MINUTES} minutes`);

  // Cleanup alarm: daily cleanup of old entries
  chrome.alarms.create(CLEANUP_ALARM, {
    delayInMinutes: 5,
    periodInMinutes: 1440, // Once per day
  });

  // Retry alarm: retry failed calendar syncs every 10 minutes
  chrome.alarms.create(RETRY_ALARM, {
    delayInMinutes: 2,
    periodInMinutes: 10,
  });
}

// ── Alarm listener ─────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('[DeadlineOS] Alarm fired:', alarm.name);

  if (alarm.name === POLL_ALARM) {
    try {
      await GmailScanner.scanInbox();
    } catch (e) {
      console.warn('[DeadlineOS] Poll scan failed:', e.message);
    }
    return;
  }

  if (alarm.name === CLEANUP_ALARM) {
    try {
      await Storage.cleanupOldEntries();
    } catch (e) {
      console.warn('[DeadlineOS] Cleanup failed:', e.message);
    }
    return;
  }

  if (alarm.name === RETRY_ALARM) {
    try {
      await processRetryQueue();
    } catch (e) {
      console.warn('[DeadlineOS] Retry queue processing failed:', e.message);
    }
    return;
  }

  // Check if it's a deadline reminder alarm
  const handled = await Notifier.handleAlarm(alarm);
  if (handled) return;

  console.log('[DeadlineOS] Unknown alarm:', alarm.name);
});

// ── Notification listeners ─────────────────────────────────────────

chrome.notifications.onClicked.addListener((notificationId) => {
  Notifier.handleNotificationClick(notificationId);
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  Notifier.handleNotificationButtonClick(notificationId, buttonIndex);
});

// ── Message listener ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'PING') {
    sendResponse({ status: 'alive' });
    return;
  }

  if (message.type === 'EMAIL_OPENED') {
    handleEmailOpened(message.payload, sendResponse);
    return true;
  }

  if (message.type === 'GET_DEADLINES') {
    Storage.getDeadlinesByBucket().then(sendResponse);
    return true;
  }

  if (message.type === 'UPDATE_STATUS') {
    Storage.updateDeadlineStatus(message.id, message.status).then((result) => {
      // Cancel notifications if marked done or dismissed
      if (message.status === 'done' || message.status === 'dismissed') {
        Notifier.cancelReminders(message.id);
      }
      sendResponse(result);
    });
    return true;
  }

  if (message.type === 'AUTHENTICATE_CALENDAR') {
    Calendar.authenticate().then(sendResponse);
    return true;
  }

  if (message.type === 'SYNC_TO_CALENDAR') {
    syncDeadlineToCalendar(message.deadlineId).then(sendResponse);
    return true;
  }

  if (message.type === 'CHECK_AUTH') {
    Calendar.isAuthenticated().then(
      (authed) => sendResponse({ authenticated: authed })
    );
    return true;
  }

  if (message.type === 'SCAN_INBOX') {
    GmailScanner.scanInbox().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_SCAN_STATUS') {
    GmailScanner.getScanStatus().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_ALL_DEADLINES_FLAT') {
    Storage.getAllDeadlines().then(sendResponse);
    return true;
  }

  if (message.type === 'SNOOZE_DEADLINE') {
    Storage.snoozeDeadline(message.id, message.hours || 24).then(sendResponse);
    return true;
  }

  if (message.type === 'DEBUG_DUMP') {
    Storage.debugDump().then(sendResponse);
    return true;
  }

  if (message.type === 'CLEAR_ALL') {
    Storage.clearAll().then(() => sendResponse({ done: true }));
    return true;
  }
});

// ── Core email pipeline ────────────────────────────────────────────

async function handleEmailOpened(emailData, sendResponse) {
  try {
    const parsed = Parser.parse(emailData);
    const scored = Scorer.score(parsed);

    console.log('[DeadlineOS SW] ─────────────────────────');
    console.log('[DeadlineOS SW] Subject :', emailData.subject);
    console.log('[DeadlineOS SW] Category:', scored.category);
    console.log('[DeadlineOS SW] Score   :', scored.score, '→', scored.action?.toUpperCase());
    console.log('[DeadlineOS SW] Deadline:', scored.deadlineRaw || 'none found');

    if (scored.action === 'ignore') {
      sendResponse({ status: 'ignored', score: scored.score });
      return;
    }

    const fp = Deduplicator.fingerprint(emailData);
    const alreadySeen = await Deduplicator.isDuplicate(fp);

    if (alreadySeen) {
      console.log('[DeadlineOS SW] → Duplicate, skipping:', fp);
      sendResponse({ status: 'duplicate' });
      return;
    }

    const deadlineObj = {
      id: fp,
      subject: scored.emailSubject,
      senderName: scored.senderName,
      senderEmail: scored.senderEmail,
      category: scored.category,
      deadline: scored.deadline,
      deadlineRaw: scored.deadlineRaw,
      deadlineDaysFromNow: scored.deadlineDaysFromNow,
      urgency: scored.urgency,
      score: scored.score,
      action: scored.action,
      emailUrl: scored.emailUrl,
      savedAt: new Date().toISOString(),
      status: scored.action === 'auto_save' ? 'pending' : 'confirm',
      calendarEventId: null,
      source: 'dom',
    };

    const saveResult = await Storage.saveDeadline(deadlineObj);
    await Deduplicator.markProcessed(fp);

    if (!saveResult.saved) {
      sendResponse({ status: 'duplicate' });
      return;
    }

    console.log('[DeadlineOS SW] → Saved:', fp);

    // Schedule notifications for this deadline
    await Notifier.scheduleReminders(deadlineObj);

    // Auto-sync to calendar for high-confidence deadlines
    // Only if user is already authenticated (non-blocking)
    if (scored.action === 'auto_save') {
      syncDeadlineToCalendar(fp).catch(err => {
        console.log('[Calendar] Auto-sync skipped:', err.message);
        // Add to retry queue
        addToRetryQueue(fp).catch(() => {});
      });
    }

    sendResponse({ status: 'saved', deadline: deadlineObj });

  } catch (err) {
    console.error('[DeadlineOS SW] Error:', err.message);
    sendResponse({ status: 'error', message: err.message });
  }
}

// ── Calendar sync helper ───────────────────────────────────────────

async function syncDeadlineToCalendar(deadlineId) {
  try {
    const authed = await Calendar.isAuthenticated();
    if (!authed) {
      console.log('[Calendar] Not authenticated — skipping auto-sync');
      return { synced: false, reason: 'not_authenticated' };
    }

    const deadlines = await Storage.getAllDeadlines();
    const deadline = deadlines.find(d => d.id === deadlineId);

    if (!deadline) {
      return { synced: false, reason: 'deadline_not_found' };
    }

    if (deadline.calendarEventId) {
      return { synced: false, reason: 'already_synced' };
    }

    const settings = await Storage.getSettings();
    const result = await Calendar.createEvent(deadline, settings.calendarId);

    if (result.created) {
      // Save the calendar event ID back to the deadline
      const deadlines = await Storage.getAllDeadlines();
      const idx = deadlines.findIndex(d => d.id === deadlineId);
      if (idx !== -1) {
        deadlines[idx].calendarEventId = result.eventId;
        deadlines[idx].calendarLink = result.htmlLink;
        deadlines[idx].status = 'synced';
        await chrome.storage.local.set({ deadlines });
      }
      console.log('[Calendar] Synced successfully:', result.htmlLink);
    }

    return result;
  } catch (err) {
    console.error('[Calendar] Sync error:', err.message);
    // Add to retry queue for later
    await addToRetryQueue(deadlineId).catch(() => {});
    return { synced: false, error: err.message };
  }
}

// ── Retry queue for failed calendar syncs ──────────────────────────

async function addToRetryQueue(deadlineId) {
  const data = await chrome.storage.local.get('retryQueue');
  const queue = data.retryQueue || [];

  // Don't add duplicates
  if (queue.some(item => item.deadlineId === deadlineId)) return;

  queue.push({
    deadlineId,
    addedAt: new Date().toISOString(),
    attempts: 0,
  });

  // Cap queue at 50 items
  if (queue.length > 50) queue.splice(0, queue.length - 50);

  await chrome.storage.local.set({ retryQueue: queue });
  console.log('[RetryQueue] Added:', deadlineId);
}

async function processRetryQueue() {
  const data = await chrome.storage.local.get('retryQueue');
  const queue = data.retryQueue || [];

  if (queue.length === 0) return;

  const authed = await Calendar.isAuthenticated().catch(() => false);
  if (!authed) return;

  console.log(`[RetryQueue] Processing ${queue.length} items...`);
  const remaining = [];

  for (const item of queue) {
    try {
      const result = await syncDeadlineToCalendar(item.deadlineId);
      if (result.synced !== false || result.reason === 'already_synced' || result.reason === 'deadline_not_found') {
        console.log('[RetryQueue] Success:', item.deadlineId);
      } else {
        item.attempts++;
        if (item.attempts < 5) {
          remaining.push(item);
        } else {
          console.log('[RetryQueue] Max retries reached, dropping:', item.deadlineId);
        }
      }
    } catch (e) {
      item.attempts++;
      if (item.attempts < 5) {
        remaining.push(item);
      }
    }
  }

  await chrome.storage.local.set({ retryQueue: remaining });
}