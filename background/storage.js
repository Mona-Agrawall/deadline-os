// background/storage.js
// Clean abstraction over chrome.storage.local.
// All deadline reads/writes go through here.
// This means if we ever switch storage backends,
// only this file changes.

const Storage = (() => {

  // ── Deadline schema ───────────────────────────────────────────────
  // Every saved deadline looks like this:
  // {
  //   id: string,              ← fingerprint (e.g. "dl_a3f2b1c4")
  //   subject: string,
  //   senderName: string,
  //   senderEmail: string,
  //   category: string,        ← INTERVIEW / ASSIGNMENT / PAYMENT / etc.
  //   deadline: string|null,   ← ISO date string or null
  //   deadlineRaw: string|null,← human-readable date from email
  //   deadlineDaysFromNow: number|null,
  //   urgency: string,         ← CRITICAL / HIGH / MEDIUM / NORMAL / LOW
  //   score: number,           ← 0.0 to 1.0
  //   action: string,          ← auto_save / confirm
  //   emailUrl: string,
  //   savedAt: string,         ← ISO timestamp when WE saved it
  //   status: string,          ← 'pending' | 'confirmed' | 'dismissed' | 'done'
  //   calendarEventId: string|null, ← filled in Step 5
  // }

  const KEYS = {
    DEADLINES: 'deadlines',
    PROCESSED_IDS: 'processed_ids',
    SETTINGS: 'settings',
  };

  const DEFAULT_SETTINGS = {
    autoSaveThreshold: 0.72,
    confirmThreshold: 0.40,
    notifyMinutesBefore: [1440, 60], // 24 hours and 1 hour before
    calendarEnabled: false,
    calendarId: 'primary',
  };

  // ── Read all deadlines ─────────────────────────────────────────────
  async function getAllDeadlines() {
    const result = await chrome.storage.local.get(KEYS.DEADLINES);
    return result.deadlines || [];
  }

  // ── Save a new deadline ────────────────────────────────────────────
  async function saveDeadline(deadlineObj) {
    const deadlines = await getAllDeadlines();

    // Check for existing entry with same ID (extra safety)
    const existingIndex = deadlines.findIndex(d => d.id === deadlineObj.id);
    if (existingIndex !== -1) {
      console.log('[Storage] Deadline already exists, skipping:', deadlineObj.id);
      return { saved: false, reason: 'duplicate' };
    }

    deadlines.push(deadlineObj);

    // Sort by deadline date (soonest first), nulls at end
    deadlines.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    });

    await chrome.storage.local.set({ [KEYS.DEADLINES]: deadlines });
    console.log('[Storage] Saved deadline:', deadlineObj.subject, '| Total:', deadlines.length);
    return { saved: true };
  }

  // ── Update a deadline's status ─────────────────────────────────────
  async function updateDeadlineStatus(id, status) {
    const deadlines = await getAllDeadlines();
    const index = deadlines.findIndex(d => d.id === id);
    if (index === -1) return false;

    deadlines[index].status = status;
    deadlines[index].updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [KEYS.DEADLINES]: deadlines });
    return true;
  }

  // ── Get deadlines by time bucket ──────────────────────────────────
  async function getDeadlinesByBucket() {
    const deadlines = await getAllDeadlines();
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const buckets = {
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
      noDate: [],
    };

    for (const d of deadlines) {
      if (d.status === 'dismissed' || d.status === 'done') continue;

      if (!d.deadline) {
        buckets.noDate.push(d);
        continue;
      }

      const deadlineDate = new Date(d.deadline);
      if (deadlineDate < now) {
        buckets.overdue.push(d);
      } else if (deadlineDate <= todayEnd) {
        buckets.today.push(d);
      } else if (deadlineDate <= weekEnd) {
        buckets.thisWeek.push(d);
      } else {
        buckets.later.push(d);
      }
    }

    return buckets;
  }

  // ── Delete a deadline ──────────────────────────────────────────────
  async function deleteDeadline(id) {
    const deadlines = await getAllDeadlines();
    const filtered = deadlines.filter(d => d.id !== id);
    await chrome.storage.local.set({ [KEYS.DEADLINES]: filtered });
    return true;
  }

  // ── Settings ───────────────────────────────────────────────────────
  async function getSettings() {
    const result = await chrome.storage.local.get(KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
  }

  async function saveSettings(updates) {
    const current = await getSettings();
    const merged = { ...current, ...updates };
    await chrome.storage.local.set({ [KEYS.SETTINGS]: merged });
    return merged;
  }

  // ── Debug helper ───────────────────────────────────────────────────
  async function debugDump() {
    const all = await chrome.storage.local.get(null);
    console.log('[Storage] Full dump:', JSON.stringify(all, null, 2));
    return all;
  }

  // ── Clear everything (for testing) ────────────────────────────────
  async function clearAll() {
    await chrome.storage.local.clear();
    console.log('[Storage] Cleared all data.');
  }

  // ── Cleanup old done/dismissed entries ─────────────────────────────
  // Removes entries older than 30 days that are done or dismissed.
  // Helps stay within chrome.storage.local 5MB quota.

  async function cleanupOldEntries() {
    const deadlines = await getAllDeadlines();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const before = deadlines.length;
    const filtered = deadlines.filter(d => {
      if (d.status !== 'done' && d.status !== 'dismissed') return true;
      const updatedAt = new Date(d.updatedAt || d.savedAt);
      return updatedAt >= thirtyDaysAgo;
    });

    if (filtered.length < before) {
      await chrome.storage.local.set({ [KEYS.DEADLINES]: filtered });
      console.log(`[Storage] Cleaned up ${before - filtered.length} old entries`);
    }
  }

  // ── Snooze a deadline ──────────────────────────────────────────────
  // Hides the deadline for N hours, then it reappears.

  async function snoozeDeadline(id, hours = 24) {
    const deadlines = await getAllDeadlines();
    const index = deadlines.findIndex(d => d.id === id);
    if (index === -1) return false;

    const snoozedUntil = new Date();
    snoozedUntil.setHours(snoozedUntil.getHours() + hours);
    deadlines[index].snoozedUntil = snoozedUntil.toISOString();
    deadlines[index].updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [KEYS.DEADLINES]: deadlines });
    console.log(`[Storage] Snoozed ${id} until ${snoozedUntil.toISOString()}`);
    return true;
  }

  // ── Get stats for dashboard footer ─────────────────────────────────

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
      if (d.status === 'done' || d.status === 'dismissed') return false;
      if (!d.deadline) return false;
      const dl = new Date(d.deadline);
      return dl >= now && dl < weekEnd;
    }).length;

    return { total, completedThisWeek, upcomingThisWeek };
  }

  return {
    getAllDeadlines,
    saveDeadline,
    updateDeadlineStatus,
    getDeadlinesByBucket,
    deleteDeadline,
    getSettings,
    saveSettings,
    debugDump,
    clearAll,
    cleanupOldEntries,
    snoozeDeadline,
    getStats,
    KEYS,
  };
})();