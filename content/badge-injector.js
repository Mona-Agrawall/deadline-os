// content/badge-injector.js
// Adds a coloured category badge next to Gmail inbox rows whose subject
// matches a saved deadline.

(() => {
  const THROTTLE_MS = 2000;      // inject at most once every 2 seconds
  const REFRESH_MS = 60 * 1000;  // reload saved deadlines every minute
  const DAY_MS = 24 * 60 * 60 * 1000;

  const BADGE_STYLES = {
    INTERVIEW:   { bg: '#1a2e4a', color: '#60a5fa', label: 'Interview' },
    ASSIGNMENT:  { bg: '#2a1f3d', color: '#a78bfa', label: 'Assignment' },
    PAYMENT:     { bg: '#2d1f1a', color: '#f97316', label: 'Payment' },
    APPLICATION: { bg: '#1a2e24', color: '#34d399', label: 'Application' },
    EVENT:       { bg: '#2a2512', color: '#fbbf24', label: 'Event' },
    REMINDER:    { bg: '#2a2a2a', color: '#9ca3af', label: 'Reminder' },
    UNKNOWN:     { bg: '#1e1e1e', color: '#6b7280', label: 'Deadline' },
  };

  let deadlines = [];
  let lastInjection = 0;

  function injectStyles() {
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
      .deadlineos-badge.urgency-today { border: 1.5px solid #e5534b; }
      .deadlineos-badge.urgency-week { border: 1.5px solid #e8a030; }
      .deadlineos-badge.urgency-normal { border: 1px solid transparent; }
      @keyframes deadlineos-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
    `;
    document.head.appendChild(style);
  }

  function fetchDeadlines() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_ALL_DEADLINES' }, (response) => {
        resolve(chrome.runtime.lastError || !Array.isArray(response) ? [] : response);
      });
    });
  }

  function normalizeSubject(subject) {
    return (subject || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Only an exact subject match counts — looser matching badged unrelated emails
  function findMatchingDeadline(rowSubject) {
    const subject = normalizeSubject(rowSubject);
    return deadlines.find(d =>
      d.status !== 'done' && d.status !== 'dismissed' && normalizeSubject(d.subject) === subject
    ) || null;
  }

  function getUrgencyClass(deadline) {
    if (!deadline.deadline) return 'urgency-normal';

    const msLeft = new Date(deadline.deadline) - new Date();
    if (msLeft < 0) return 'urgency-overdue';
    if (msLeft < DAY_MS) return 'urgency-today';
    if (msLeft <= 7 * DAY_MS) return 'urgency-week';
    return 'urgency-normal';
  }

  function createBadge(deadline) {
    const style = BADGE_STYLES[deadline.category] || BADGE_STYLES.UNKNOWN;
    const badge = document.createElement('span');
    badge.className = `deadlineos-badge ${getUrgencyClass(deadline)}`;
    badge.style.backgroundColor = style.bg;
    badge.style.color = style.color;
    badge.textContent = `${getCategoryEmoji(deadline.category)} ${style.label}`;
    badge.title = `Deadline OS: ${deadline.category} — ${deadline.deadlineRaw || 'No date'}`;
    return badge;
  }

  function injectBadges() {
    const now = Date.now();
    if (now - lastInjection < THROTTLE_MS || deadlines.length === 0) return;
    lastInjection = now;

    // Gmail inbox rows are <tr class="zA">; the subject uses .bog / .bqe / .y2
    for (const row of document.querySelectorAll('tr.zA')) {
      if (row.querySelector('.deadlineos-badge')) continue;

      const subjectEl = row.querySelector('.bog, .bqe, .y2');
      const subject = subjectEl?.innerText?.trim();
      if (!subject) continue;

      const match = findMatchingDeadline(subject);
      if (match) subjectEl.after(createBadge(match));
    }
  }

  async function init() {
    injectStyles();
    deadlines = await fetchDeadlines();
    injectBadges();

    // Re-inject whenever Gmail re-renders the inbox list
    const container = document.querySelector('.AO') || document.body;
    new MutationObserver(injectBadges).observe(container, { childList: true, subtree: true });

    setInterval(async () => {
      deadlines = await fetchDeadlines();
      injectBadges();
    }, REFRESH_MS);
  }

  // Give Gmail time to render before the first pass
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
  } else {
    setTimeout(init, 2000);
  }
})();
