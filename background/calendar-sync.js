// background/calendar-sync.js
// Adds saved deadlines to Google Calendar. Syncs that fail (e.g. network
// errors) go into a retry queue that the service worker drains every 10 min.

const CalendarSync = (() => {

  const RETRY_QUEUE_KEY = 'retryQueue';
  const MAX_QUEUE_SIZE = 50;
  const MAX_ATTEMPTS = 5;

  // Results that will never succeed, so retrying is pointless
  const FINAL_REASONS = ['already_synced', 'deadline_not_found'];

  async function syncDeadline(deadlineId) {
    try {
      if (!(await Auth.isAuthenticated())) {
        return { synced: false, reason: 'not_authenticated' };
      }

      const deadline = await Storage.getDeadline(deadlineId);
      if (!deadline) return { synced: false, reason: 'deadline_not_found' };
      if (deadline.calendarEventId) return { synced: false, reason: 'already_synced' };

      const result = await Calendar.createEvent(deadline);
      if (result.created) {
        await Storage.updateDeadline(deadlineId, {
          calendarEventId: result.eventId,
          calendarLink: result.htmlLink,
          status: 'synced',
        });
      }
      return result;
    } catch (err) {
      console.error('[CalendarSync] Sync failed:', err.message);
      await addToRetryQueue(deadlineId);
      return { synced: false, error: err.message };
    }
  }

  async function getRetryQueue() {
    const result = await chrome.storage.local.get(RETRY_QUEUE_KEY);
    return result[RETRY_QUEUE_KEY] || [];
  }

  async function addToRetryQueue(deadlineId) {
    const queue = await getRetryQueue();
    if (queue.some(item => item.deadlineId === deadlineId)) return;

    queue.push({ deadlineId, addedAt: new Date().toISOString(), attempts: 0 });
    await chrome.storage.local.set({ [RETRY_QUEUE_KEY]: queue.slice(-MAX_QUEUE_SIZE) });
  }

  async function processRetryQueue() {
    const queue = await getRetryQueue();
    if (queue.length === 0 || !(await Auth.isAuthenticated())) return;

    const remaining = [];
    for (const item of queue) {
      const result = await syncDeadline(item.deadlineId);
      const failed = result.synced === false && !FINAL_REASONS.includes(result.reason);
      if (!failed) continue;

      item.attempts++;
      if (item.attempts < MAX_ATTEMPTS) remaining.push(item);
    }

    await chrome.storage.local.set({ [RETRY_QUEUE_KEY]: remaining });
  }

  return { syncDeadline, processRetryQueue };
})();
