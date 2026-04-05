// content/badge-injector.js
// Injects colored emoji badges next to Gmail inbox rows
// that match stored deadlines.
// Runs as a content script on mail.google.com.

(() => {
  let deadlines = [];
  let badgeStyleInjected = false;
  let observer = null;
  let lastCheck = 0;
  const CHECK_INTERVAL = 2000; // Don't check more than once per 2 seconds

  // ── Category → emoji + color map ───────────────────────────────────

  const BADGE_CONFIG = {
    INTERVIEW:   { emoji: '🎯', bg: '#1a2e4a', color: '#60a5fa', label: 'Interview' },
    ASSIGNMENT:  { emoji: '📝', bg: '#2a1f3d', color: '#a78bfa', label: 'Assignment' },
    PAYMENT:     { emoji: '💳', bg: '#2d1f1a', color: '#f97316', label: 'Payment' },
    APPLICATION: { emoji: '📋', bg: '#1a2e24', color: '#34d399', label: 'Application' },
    EVENT:       { emoji: '📅', bg: '#2a2512', color: '#fbbf24', label: 'Event' },
    REMINDER:    { emoji: '⏰', bg: '#2a2a2a', color: '#9ca3af', label: 'Reminder' },
    UNKNOWN:     { emoji: '⏰', bg: '#1e1e1e', color: '#6b7280', label: 'Deadline' },
  };

  // ── Inject badge CSS ───────────────────────────────────────────────

  function injectStyles() {
    if (badgeStyleInjected) return;
    const style = document.createElement('style');
    style.id = 'deadlineos-badge-styles';
    style.textContent = `
      .deadlineos-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        line-height: 18px;
        margin-left: 6px;
        vertical-align: middle;
        white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .deadlineos-badge.urgency-overdue {
        border: 1.5px solid #e5534b;
        animation: deadlineos-pulse 2s ease-in-out infinite;
      }
      .deadlineos-badge.urgency-today {
        border: 1.5px solid #e5534b;
      }
      .deadlineos-badge.urgency-week {
        border: 1.5px solid #e8a030;
      }
      .deadlineos-badge.urgency-normal {
        border: 1px solid transparent;
      }
      @keyframes deadlineos-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
    `;
    document.head.appendChild(style);
    badgeStyleInjected = true;
  }

  // ── Fetch deadlines from service worker ────────────────────────────

  function fetchDeadlines() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_ALL_DEADLINES_FLAT' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve([]);
          return;
        }
        resolve(response);
      });
    });
  }

  // ── Fuzzy match: does inbox row subject match a stored deadline? ──

  function findMatchingDeadline(rowSubject) {
    if (!rowSubject) return null;
    const normalized = rowSubject.toLowerCase().trim();

    for (const d of deadlines) {
      if (!d.subject) continue;
      // Skip done/dismissed deadlines
      if (d.status === 'done' || d.status === 'dismissed') continue;

      const dSubject = d.subject.toLowerCase().trim();

      // Exact match
      if (normalized === dSubject) return d;

      // Substring match (either direction — handles truncated subjects)
      if (normalized.includes(dSubject) || dSubject.includes(normalized)) return d;

      // Word overlap check (at least 3 words matching)
      const rowWords = normalized.split(/\s+/).filter(w => w.length > 2);
      const dlWords = dSubject.split(/\s+/).filter(w => w.length > 2);
      const overlap = rowWords.filter(w => dlWords.includes(w));
      if (overlap.length >= 3) return d;
    }

    return null;
  }

  // ── Determine urgency class ────────────────────────────────────────

  function getUrgencyClass(deadline) {
    if (!deadline.deadline) return 'urgency-normal';

    const deadlineDate = new Date(deadline.deadline);
    const now = new Date();
    const diffMs = deadlineDate - now;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffMs < 0) return 'urgency-overdue';
    if (diffDays < 1) return 'urgency-today';
    if (diffDays <= 7) return 'urgency-week';
    return 'urgency-normal';
  }

  // ── Inject badges into inbox rows ──────────────────────────────────

  function injectBadges() {
    const now = Date.now();
    if (now - lastCheck < CHECK_INTERVAL) return;
    lastCheck = now;

    if (deadlines.length === 0) return;

    // Gmail inbox rows use the class 'zA' on <tr> elements
    const rows = document.querySelectorAll('tr.zA');
    if (rows.length === 0) return;

    for (const row of rows) {
      // Skip if already badged
      if (row.querySelector('.deadlineos-badge')) continue;

      // Find the subject span — Gmail uses '.bog' or '.bqe' classes
      const subjectEl = row.querySelector('.bog, .bqe, .y2');
      if (!subjectEl) continue;

      const subject = subjectEl.innerText?.trim();
      if (!subject) continue;

      const match = findMatchingDeadline(subject);
      if (!match) continue;

      // Create badge
      const config = BADGE_CONFIG[match.category] || BADGE_CONFIG.UNKNOWN;
      const urgencyClass = getUrgencyClass(match);

      const badge = document.createElement('span');
      badge.className = `deadlineos-badge ${urgencyClass}`;
      badge.style.backgroundColor = config.bg;
      badge.style.color = config.color;
      badge.textContent = `${config.emoji} ${config.label}`;
      badge.title = `Deadline OS: ${match.category} — ${match.deadlineRaw || 'No date'}`;

      // Insert after the subject
      subjectEl.parentNode.insertBefore(badge, subjectEl.nextSibling);
    }
  }

  // ── Start observing Gmail DOM for navigation changes ───────────────

  function startObserver() {
    if (observer) return;

    // Watch the main content area for changes (inbox list re-renders)
    const target = document.querySelector('.AO') || document.body;

    observer = new MutationObserver(() => {
      injectBadges();
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
    });
  }

  // ── Init ───────────────────────────────────────────────────────────

  async function init() {
    console.log('[DeadlineOS Badge] Initializing badge injector...');

    injectStyles();

    // Fetch deadlines
    try {
      deadlines = await fetchDeadlines();
      console.log(`[DeadlineOS Badge] Loaded ${deadlines.length} deadlines for matching`);
    } catch (e) {
      console.warn('[DeadlineOS Badge] Could not fetch deadlines:', e.message);
      return;
    }

    // Inject on current page
    injectBadges();

    // Watch for DOM changes (Gmail SPA navigation)
    startObserver();

    // Periodically refresh deadline data (every 60 seconds)
    setInterval(async () => {
      try {
        deadlines = await fetchDeadlines();
        injectBadges();
      } catch (e) {
        // Silent fail
      }
    }, 60000);
  }

  // Wait for Gmail to load, then init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
  } else {
    setTimeout(init, 2000);
  }

})();
