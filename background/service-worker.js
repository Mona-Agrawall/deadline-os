// background/service-worker.js
// Entry point of the extension's background. Loads every module,
// schedules periodic alarms and answers messages from the popup and
// the Gmail content scripts.

importScripts(
  '/utils/categories.js',
  '/utils/date-utils.js',
  '/utils/sender-domains.js',
  '/background/storage.js',
  '/background/deduplicator.js',
  '/background/parser.js',
  '/background/scorer.js',
  '/background/auth.js',
  '/background/calendar.js',
  '/background/calendar-sync.js',
  '/background/notifier.js',
  '/background/email-pipeline.js',
  '/background/gmail-scanner.js'
);

// ── Alarms ─────────────────────────────────────────────────────────

const ALARMS = {
  POLL: 'deadlineos-poll',
  CLEANUP: 'deadlineos-cleanup',
  RETRY: 'deadlineos-retry',
};

function setupAlarms() {
  chrome.alarms.create(ALARMS.POLL, { delayInMinutes: 1, periodInMinutes: 30 });     // scan Gmail
  chrome.alarms.create(ALARMS.CLEANUP, { delayInMinutes: 5, periodInMinutes: 1440 }); // daily cleanup
  chrome.alarms.create(ALARMS.RETRY, { delayInMinutes: 2, periodInMinutes: 10 });     // retry calendar syncs
}

const ALARM_HANDLERS = {
  [ALARMS.POLL]: () => GmailScanner.scanInbox(),
  [ALARMS.CLEANUP]: () => Storage.cleanupOldEntries(),
  [ALARMS.RETRY]: () => CalendarSync.processRetryQueue(),
};

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Any other alarm is a deadline reminder
  const handler = ALARM_HANDLERS[alarm.name] || Notifier.handleAlarm;
  try {
    await handler(alarm);
  } catch (e) {
    console.warn(`[DeadlineOS] Alarm "${alarm.name}" failed:`, e.message);
  }
});

// ── Lifecycle ──────────────────────────────────────────────────────

function onLaunch() {
  setupAlarms();
  Notifier.rescheduleAll();
}

chrome.runtime.onInstalled.addListener(onLaunch);
chrome.runtime.onStartup.addListener(onLaunch);

// ── Notifications ──────────────────────────────────────────────────

chrome.notifications.onClicked.addListener((notificationId) => {
  Notifier.handleNotificationClick(notificationId);
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  Notifier.handleNotificationClick(notificationId, buttonIndex);
});

// ── Messages ───────────────────────────────────────────────────────

const MESSAGE_HANDLERS = {
  // From content/gmail-observer.js
  EMAIL_OPENED: ({ payload }) => EmailPipeline.processEmail(payload, 'dom'),

  // From content/badge-injector.js and the popup
  GET_ALL_DEADLINES: () => Storage.getAllDeadlines(),

  // From the popup
  GET_DEADLINES: () => Storage.getDeadlinesByBucket(),
  GET_STATS: () => Storage.getStats(),
  GET_SCAN_STATUS: () => GmailScanner.getScanStatus(),
  SCAN_INBOX: () => GmailScanner.scanInbox(),
  SNOOZE_DEADLINE: ({ id, hours }) => Storage.snoozeDeadline(id, hours),
  SYNC_TO_CALENDAR: ({ deadlineId }) => CalendarSync.syncDeadline(deadlineId),
  CHECK_AUTH: async () => ({ authenticated: await Auth.isAuthenticated() }),
  AUTHENTICATE: () => Auth.authenticate(),

  UPDATE_STATUS: async ({ id, status }) => {
    const updated = await Storage.updateDeadlineStatus(id, status);
    if (status === 'done' || status === 'dismissed') Notifier.cancelReminders(id);
    return updated;
  },

  CLEAR_ALL: async () => {
    await Storage.clearAll();
    return { done: true };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[message.type];
  if (!handler) return false;

  Promise.resolve()
    .then(() => handler(message))
    .then(sendResponse, (err) => sendResponse({ status: 'error', message: err.message }));

  return true; // keeps the message channel open for the async response
});
