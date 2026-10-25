// background/storage.js
// All reads and writes of saved deadlines go through this module.
//
// A saved deadline looks like:
// {
//   id: string,                  ← fingerprint, e.g. "dl_a3f2b1c4"
//   subject, senderName, senderEmail: string,
//   category: string,            ← INTERVIEW / ASSIGNMENT / PAYMENT / ...
//   deadline: string|null,       ← ISO date
//   deadlineRaw: string|null,    ← date text as written in the email
//   deadlineDaysFromNow: number|null,
//   urgency: string,             ← CRITICAL / HIGH / MEDIUM / NORMAL / LOW
//   score: number,               ← confidence 0.0 – 1.0
//   action: string,              ← 'auto_save' | 'confirm'
//   emailUrl: string,
//   savedAt: string,             ← ISO timestamp
//   status: string,              ← 'confirm' | 'pending' | 'synced' | 'done' | 'dismissed'
//   source: string,              ← 'dom' | 'gmail_api'
//   calendarEventId, calendarLink: string|null,
//   snoozedUntil, updatedAt: string (optional)
// }

const Storage = (() => {

  const DEADLINES_KEY = 'deadlines';
  const CLEANUP_AFTER_DAYS = 30;

  function isResolved(deadline) {
    return deadline.status === 'done' || deadline.status === 'dismissed';
  }

  async function getAllDeadlines() {
    const result = await chrome.storage.local.get(DEADLINES_KEY);
    return result[DEADLINES_KEY] || [];
  }

  async function saveAllDeadlines(deadlines) {
    await chrome.storage.local.set({ [DEADLINES_KEY]: deadlines });
  }

  async function getDeadline(id) {
    const deadlines = await getAllDeadlines();
    return deadlines.find(d => d.id === id) || null;
  }

  // Adds a new deadline, keeping the list sorted soonest-first (no date last)
  async function saveDeadline(deadline) {
    const deadlines = await getAllDeadlines();
    if (deadlines.some(d => d.id === deadline.id)) {
      return { saved: false, reason: 'duplicate' };
    }

    deadlines.push(deadline);
    deadlines.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    });

    await saveAllDeadlines(deadlines);
    return { saved: true };
  }

  // Merges `changes` into the stored deadline. Returns false if not found.
  async function updateDeadline(id, changes) {
    const deadlines = await getAllDeadlines();
    const deadline = deadlines.find(d => d.id === id);
    if (!deadline) return false;

    Object.assign(deadline, changes);
    await saveAllDeadlines(deadlines);
    return true;
  }

  function updateDeadlineStatus(id, status) {
    return updateDeadline(id, { status, updatedAt: new Date().toISOString() });
  }

  // Hides the deadline in the popup for `hours`
  function snoozeDeadline(id, hours = 24) {
    const snoozedUntil = new Date();
    snoozedUntil.setHours(snoozedUntil.getHours() + hours);
    return updateDeadline(id, {
      snoozedUntil: snoozedUntil.toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Groups active deadlines for the popup: overdue / today / this week / later / no date
  async function getDeadlinesByBucket() {
    const deadlines = await getAllDeadlines();
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const buckets = { overdue: [], today: [], thisWeek: [], later: [], noDate: [] };

    for (const d of deadlines) {
      if (isResolved(d)) continue;

      if (!d.deadline) {
        buckets.noDate.push(d);
        continue;
      }

      const date = new Date(d.deadline);
      if (date < now) buckets.overdue.push(d);
      else if (date <= todayEnd) buckets.today.push(d);
      else if (date <= weekEnd) buckets.thisWeek.push(d);
      else buckets.later.push(d);
    }

    return buckets;
  }

  // Numbers shown in the popup footer
  async function getStats() {
    const deadlines = await getAllDeadlines();
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const total = deadlines.filter(d => d.status !== 'dismissed').length;

    const completedThisWeek = deadlines.filter(d => {
      if (d.status !== 'done') return false;
      const updated = new Date(d.updatedAt || d.savedAt);
      return updated >= weekStart && updated < weekEnd;
    }).length;

    const upcomingThisWeek = deadlines.filter(d => {
      if (isResolved(d) || !d.deadline) return false;
      const date = new Date(d.deadline);
      return date >= now && date < weekEnd;
    }).length;

    return { total, completedThisWeek, upcomingThisWeek };
  }

  // Deletes done/dismissed deadlines older than CLEANUP_AFTER_DAYS
  // to stay well within the chrome.storage.local quota.
  async function cleanupOldEntries() {
    const deadlines = await getAllDeadlines();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CLEANUP_AFTER_DAYS);

    const kept = deadlines.filter(d =>
      !isResolved(d) || new Date(d.updatedAt || d.savedAt) >= cutoff
    );

    if (kept.length < deadlines.length) {
      await saveAllDeadlines(kept);
    }
  }

  async function clearAll() {
    await chrome.storage.local.clear();
  }

  return {
    isResolved,
    getAllDeadlines,
    getDeadline,
    saveDeadline,
    updateDeadline,
    updateDeadlineStatus,
    snoozeDeadline,
    getDeadlinesByBucket,
    getStats,
    cleanupOldEntries,
    clearAll,
  };
})();
