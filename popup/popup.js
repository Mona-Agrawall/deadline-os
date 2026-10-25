// popup/popup.js
// Renders the deadline dashboard and handles its buttons.
// All data comes from the service worker via chrome.runtime messages.

const content = document.getElementById('content');
const scanBtn = document.getElementById('scanBtn');
const scanStatusText = document.getElementById('scanStatusText');
const scanNewCount = document.getElementById('scanNewCount');
const authBanner = document.getElementById('authBanner');
const authStatus = document.getElementById('authStatus');
const connectBtn = document.getElementById('connectCalBtn');

const DAY_MS = 24 * 60 * 60 * 1000;
const SNOOZE_HOURS = 24;

const SECTIONS = [
  { key: 'overdue', title: 'Overdue', dot: 'dot-overdue' },
  { key: 'today', title: 'Today', dot: 'dot-today' },
  { key: 'thisWeek', title: 'This week', dot: 'dot-week' },
  { key: 'later', title: 'Later', dot: 'dot-later' },
  { key: 'noDate', title: 'No date found', dot: 'dot-nodate' },
];

// ── Helpers ────────────────────────────────────────────────────────

// Resolves with the service worker's response, or null if it failed
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(chrome.runtime.lastError ? null : response);
    });
  });
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stateMessage(emoji, html) {
  return `<div class="state-msg"><div class="emoji">${emoji}</div>${html}</div>`;
}

// → { text, cls, days } describing how far away the deadline is
function describeDueDate(isoString) {
  if (!isoString) return null;

  const date = new Date(isoString);
  const days = Math.ceil((date - new Date()) / DAY_MS);

  if (days < 0) return { text: days === -1 ? '1 day overdue' : `${-days} days overdue`, cls: 'overdue', days };
  if (days === 0) return { text: 'Due today', cls: 'soon', days };
  if (days === 1) return { text: 'Due tomorrow', cls: 'soon', days };
  if (days <= 7) return { text: `In ${days} days`, cls: '', days };
  return { text: date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }), cls: '', days };
}

function formatTimeAgo(isoString) {
  const minutes = Math.floor((Date.now() - new Date(isoString).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getAccountLabel(email) {
  const domain = (email || '').split('@')[1];
  if (SenderDomains.matches(domain, SenderDomains.COLLEGE)) return 'SRM';
  if (domain === 'gmail.com') return 'Personal';
  return '';
}

// ── Card ───────────────────────────────────────────────────────────

function buildDaysCounter(due) {
  if (!due) return '';

  let cls = 'later';
  let title = `${due.days} day${due.days === 1 ? '' : 's'} left`;
  if (due.days < 0) { cls = 'overdue'; title = 'Overdue'; }
  else if (due.days === 0) { cls = 'today'; title = 'Due today'; }
  else if (due.days <= 7) cls = 'week';

  const value = due.days === 0 ? '!' : Math.abs(due.days);
  return `<div class="card-days ${cls}" title="${title}">${value}</div>`;
}

function buildCard(deadline, needsReview) {
  const due = describeDueDate(deadline.deadline);
  const category = deadline.category || 'UNKNOWN';
  const accountLabel = getAccountLabel(deadline.senderEmail);
  const id = escapeHtml(deadline.id);

  const dateHtml = due
    ? `<span class="card-date ${due.cls}">${escapeHtml(due.text)}</span>`
    : `<span class="card-date">${escapeHtml(deadline.deadlineRaw || 'No date found')}</span>`;

  const calendarButton = deadline.calendarEventId
    ? `<a href="${escapeHtml(deadline.calendarLink || '#')}" target="_blank" class="btn btn-cal-done" title="Open in Google Calendar">📅 In Calendar</a>`
    : `<button class="btn btn-cal" data-id="${id}" data-action="sync" title="Add to Google Calendar">📅 Add to Cal</button>`;

  const statusButtons = needsReview
    ? `<button class="btn btn-confirm" data-id="${id}" data-action="confirm">✓ Yes, track this</button>
       <button class="btn btn-reject" data-id="${id}" data-action="dismiss">✗ Not a deadline</button>`
    : `<button class="btn btn-done" data-id="${id}" data-action="done">✓ Done</button>`;

  const snoozeButton = needsReview
    ? ''
    : `<button class="btn btn-snooze" data-id="${id}" data-action="snooze" title="Snooze for ${SNOOZE_HOURS} hours">💤 Snooze</button>`;

  return `
    <div class="card ${needsReview ? 'card-confirm' : ''}">
      <div class="card-top">
        <div class="card-subject">${escapeHtml(deadline.subject)}</div>
        ${buildDaysCounter(due)}
        <button class="card-dismiss" data-id="${id}" data-action="dismiss" title="Dismiss">×</button>
      </div>
      <div class="card-meta">
        <span class="badge badge-${escapeHtml(category)}">${escapeHtml(category)}</span>
        ${dateHtml}
        ${deadline.senderName ? `<span class="card-sender">${escapeHtml(deadline.senderName)}</span>` : ''}
        ${accountLabel ? `<span class="card-account">${accountLabel}</span>` : ''}
        ${deadline.calendarEventId ? '<span class="card-cal-status">📅 ✓</span>' : ''}
      </div>
      <div class="card-actions">
        <button class="btn btn-open" data-url="${escapeHtml(deadline.emailUrl)}">Open email</button>
        ${statusButtons}
        ${calendarButton}
        ${snoozeButton}
      </div>
    </div>
  `;
}

function buildSection(title, dotClass, deadlines, needsReview = false) {
  if (deadlines.length === 0) return '';

  return `
    <div class="section">
      <div class="section-header">
        <span class="dot ${dotClass}"></span>
        ${title}
        <span class="section-count">${deadlines.length}</span>
      </div>
      ${deadlines.map(d => buildCard(d, needsReview)).join('')}
    </div>
  `;
}

// ── Rendering ──────────────────────────────────────────────────────

async function render() {
  content.innerHTML = stateMessage('⏳', 'Loading...');

  const buckets = await sendMessage({ type: 'GET_DEADLINES' });
  if (!buckets) {
    content.innerHTML = stateMessage('⚠️', 'Could not load deadlines.<br>Try refreshing.');
    return;
  }

  // Snoozed deadlines are hidden; low-confidence ones go to "Needs Review"
  const now = new Date().toISOString();
  const isVisible = d => !(d.snoozedUntil && d.snoozedUntil > now);
  const needsReview = d => d.status === 'confirm';

  const reviewItems = Object.values(buckets).flat().filter(d => isVisible(d) && needsReview(d));
  const sectionsHtml = SECTIONS
    .map(s => buildSection(s.title, s.dot, buckets[s.key].filter(d => isVisible(d) && !needsReview(d))))
    .join('');

  content.innerHTML = (sectionsHtml + buildSection('Needs Review', 'dot-confirm', reviewItems, true)) ||
    stateMessage('✅', 'No deadlines found yet.<br><span class="hint">Open emails in Gmail or click Scan to start tracking.</span>');

  updateStats();
}

async function updateStats() {
  const stats = await sendMessage({ type: 'GET_STATS' });
  if (!stats) return;

  document.getElementById('statTotal').textContent = stats.total;
  document.getElementById('statCompleted').textContent = stats.completedThisWeek;
  document.getElementById('statUpcoming').textContent = stats.upcomingThisWeek;
}

function showNewCount(count) {
  scanNewCount.textContent = `+${count} new`;
  scanNewCount.hidden = !(count > 0);
}

async function updateScanStatus() {
  const status = await sendMessage({ type: 'GET_SCAN_STATUS' });
  if (!status) {
    scanStatusText.textContent = 'Scan status unavailable';
    return;
  }

  scanStatusText.textContent = status.lastScanTime
    ? `Last scanned: ${formatTimeAgo(status.lastScanTime)}`
    : 'Not yet scanned';
  showNewCount(status.lastScanResults?.newDeadlines || 0);
}

async function updateAuthState() {
  const response = await sendMessage({ type: 'CHECK_AUTH' });
  if (!response) return;

  const connected = response.authenticated;
  authBanner.hidden = connected;
  authStatus.textContent = connected ? '✓ Calendar connected' : 'Gmail deadline tracker';
  authStatus.classList.toggle('connected', connected);
}

// ── Calendar ───────────────────────────────────────────────────────

// After connecting, add every saved deadline that isn't in the calendar yet.
// Runs one at a time because each sync rewrites the stored deadline list.
async function syncAllPending() {
  const deadlines = await sendMessage({ type: 'GET_ALL_DEADLINES' }) || [];
  const pending = deadlines.filter(d =>
    (d.status === 'pending' || d.status === 'synced') && !d.calendarEventId
  );
  if (pending.length === 0) return;

  for (const d of pending) {
    await sendMessage({ type: 'SYNC_TO_CALENDAR', deadlineId: d.id });
  }
  render();
}

async function syncToCalendar(button, deadlineId) {
  button.textContent = 'Syncing...';
  button.disabled = true;

  const result = await sendMessage({ type: 'SYNC_TO_CALENDAR', deadlineId });
  if (result?.created || result?.reason === 'already_exists') {
    render();
    return;
  }

  button.textContent = '📅 Add to Cal';
  button.disabled = false;
  if (result?.reason === 'not_authenticated' || result?.error?.includes('Not authenticated')) {
    alert('Please connect your Google Calendar first using the banner above.');
  }
}

// ── Event listeners ────────────────────────────────────────────────

scanBtn.addEventListener('click', async () => {
  scanBtn.disabled = true;
  scanBtn.textContent = '⏳ Scanning...';
  scanStatusText.innerHTML = '<span class="scan-spinner"></span> Scanning inbox...';

  const result = await sendMessage({ type: 'SCAN_INBOX' });
  scanBtn.disabled = false;
  scanBtn.textContent = '🔍 Scan';

  if (!result) {
    scanStatusText.textContent = 'Scan failed';
    return;
  }
  if (result.error === 'not_authenticated') {
    scanStatusText.textContent = 'Connect your account first ↓';
    return;
  }

  scanStatusText.textContent = `Scanned ${result.scanned} emails`;
  if (result.newDeadlines > 0) showNewCount(result.newDeadlines);
  render();
  setTimeout(updateScanStatus, 2000);
});

connectBtn.addEventListener('click', async () => {
  connectBtn.textContent = 'Connecting...';
  connectBtn.disabled = true;

  const response = await sendMessage({ type: 'AUTHENTICATE' });
  if (response?.success) {
    updateAuthState();
    syncAllPending();
    return;
  }

  connectBtn.textContent = 'Connect';
  connectBtn.disabled = false;
  if (response) alert('Calendar connection failed.\n\n' + (response.error || 'Unknown error'));
});

// Card buttons (event delegation — cards are re-rendered often)
content.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-action], [data-url]');
  if (!button) return;

  if (button.dataset.url) {
    chrome.tabs.create({ url: button.dataset.url });
    return;
  }

  const { action, id } = button.dataset;
  if (!action || !id) return;

  switch (action) {
    case 'done':
      await sendMessage({ type: 'UPDATE_STATUS', id, status: 'done' });
      break;
    case 'dismiss':
      await sendMessage({ type: 'UPDATE_STATUS', id, status: 'dismissed' });
      break;
    case 'confirm': // "Needs Review" → tracked
      await sendMessage({ type: 'UPDATE_STATUS', id, status: 'pending' });
      break;
    case 'snooze':
      await sendMessage({ type: 'SNOOZE_DEADLINE', id, hours: SNOOZE_HOURS });
      break;
    case 'sync':
      syncToCalendar(button, id);
      return;
    default:
      return;
  }
  render();
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  render();
  updateScanStatus();
});

document.getElementById('clearBtn').addEventListener('click', async () => {
  if (!confirm('Clear all tracked deadlines? This cannot be undone.')) return;
  await sendMessage({ type: 'CLEAR_ALL' });
  render();
});

// ── Init ───────────────────────────────────────────────────────────

render();
updateAuthState();
updateScanStatus();
