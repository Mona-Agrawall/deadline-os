// popup/popup.js
// Renders saved deadlines from chrome.storage into the dashboard UI.
// Includes Google Calendar sync, scan controls, snooze, confirm section, and stats.

const content = document.getElementById('content');
const scanStatusText = document.getElementById('scanStatusText');
const scanNewCount = document.getElementById('scanNewCount');
const scanBtn = document.getElementById('scanBtn');

// ── Helpers ────────────────────────────────────────────────────────

function formatDate(isoString) {
  if (!isoString) return null;

  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const ago = Math.abs(diffDays);
    return { text: ago === 1 ? '1 day overdue' : `${ago} days overdue`, cls: 'overdue', days: diffDays };
  }
  if (diffDays === 0) return { text: 'Due today', cls: 'soon', days: 0 };
  if (diffDays === 1) return { text: 'Due tomorrow', cls: 'soon', days: 1 };
  if (diffDays <= 7) return { text: `In ${diffDays} days`, cls: '', days: diffDays };

  return {
    text: date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    cls: '',
    days: diffDays,
  };
}

function formatTimeAgo(isoString) {
  if (!isoString) return 'Never scanned';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getAccountLabel(email) {
  if (!email) return '';
  if (email.includes('srmist.edu.in') || email.includes('srm.edu.in')) return 'SRM';
  if (email.includes('gmail.com')) return 'Personal';
  return '';
}

// ── Card builder ───────────────────────────────────────────────────

function buildCard(deadline, isConfirmSection) {
  const dateInfo = formatDate(deadline.deadline);
  const cat = deadline.category || 'UNKNOWN';

  const dateHtml = dateInfo
    ? `<span class="card-date ${dateInfo.cls}">${escapeHtml(dateInfo.text)}</span>`
    : `<span class="card-date">${escapeHtml(deadline.deadlineRaw || 'No date found')}</span>`;

  const senderHtml = deadline.senderName
    ? `<span class="card-sender">${escapeHtml(deadline.senderName)}</span>`
    : '';

  // Account label
  const accountLabel = getAccountLabel(deadline.senderEmail);
  const accountHtml = accountLabel
    ? `<span class="card-account">${escapeHtml(accountLabel)}</span>`
    : '';

  // Calendar status
  const calStatusHtml = deadline.calendarEventId
    ? `<span class="card-cal-status">📅 ✓</span>`
    : '';

  // Calendar button
  const calBtn = deadline.calendarEventId
    ? `<a href="${escapeHtml(deadline.calendarLink || '#')}"
          target="_blank"
          class="btn btn-cal-done"
          title="Open in Google Calendar">
          📅 In Calendar
       </a>`
    : `<button class="btn btn-cal"
          data-id="${deadline.id}"
          data-action="sync"
          title="Add to Google Calendar">
          📅 Add to Cal
       </button>`;

  // Confirm/reject buttons for the confirm section
  const confirmBtns = isConfirmSection
    ? `<button class="btn btn-confirm" data-id="${deadline.id}" data-action="confirm">✓ Yes, track this</button>
       <button class="btn btn-reject" data-id="${deadline.id}" data-action="dismiss">✗ Not a deadline</button>`
    : '';

  // Snooze button (for non-confirm cards)
  const snoozeBtn = !isConfirmSection
    ? `<button class="btn btn-snooze" data-id="${deadline.id}" data-action="snooze" title="Snooze for 24 hours">💤 Snooze</button>`
    : '';

  // Days remaining badge (prominent)
  let daysHtml = '';
  if (dateInfo && dateInfo.days !== undefined) {
    let daysCls = 'later';
    if (dateInfo.days < 0) daysCls = 'overdue';
    else if (dateInfo.days === 0) daysCls = 'today';
    else if (dateInfo.days <= 7) daysCls = 'week';

    const daysText = dateInfo.days < 0
      ? Math.abs(dateInfo.days)
      : dateInfo.days;
    const daysLabel = dateInfo.days < 0 ? 'overdue' : (dateInfo.days === 0 ? 'today' : `day${dateInfo.days !== 1 ? 's' : ''}`);
    daysHtml = `<div class="card-days ${daysCls}" title="${dateInfo.days < 0 ? 'Overdue' : daysText + ' ' + daysLabel}">${daysText === 0 ? '!' : daysText}</div>`;
  }

  return `
    <div class="card ${isConfirmSection ? 'card-confirm' : ''}" data-id="${deadline.id}">
      <div class="card-top">
        <div class="card-subject">${escapeHtml(deadline.subject)}</div>
        ${daysHtml}
        <button class="card-dismiss" data-id="${deadline.id}" data-action="dismiss" title="Dismiss">×</button>
      </div>
      <div class="card-meta">
        <span class="badge badge-${cat}">${cat}</span>
        ${dateHtml}
        ${senderHtml}
        ${accountHtml}
        ${calStatusHtml}
      </div>
      <div class="card-actions">
        <button class="btn btn-open" data-url="${escapeHtml(deadline.emailUrl)}">Open email</button>
        ${isConfirmSection ? confirmBtns : `<button class="btn btn-done" data-id="${deadline.id}" data-action="done">✓ Done</button>`}
        ${calBtn}
        ${snoozeBtn}
      </div>
    </div>
  `;
}

// ── Section builder ────────────────────────────────────────────────

function buildSection(title, dotClass, items, isConfirmSection = false) {
  if (items.length === 0) return '';

  const cards = items.map(d => buildCard(d, isConfirmSection)).join('');
  return `
    <div class="section">
      <div class="section-header">
        <span class="dot ${dotClass}"></span>
        ${title}
        <span class="section-count">${items.length}</span>
      </div>
      ${cards}
    </div>
  `;
}

// ── Main render ────────────────────────────────────────────────────

function render() {
  content.innerHTML = `<div class="state-msg"><div class="emoji">⏳</div>Loading...</div>`;

  chrome.runtime.sendMessage({ type: 'GET_DEADLINES' }, (buckets) => {
    if (chrome.runtime.lastError || !buckets) {
      content.innerHTML = `
        <div class="state-msg">
          <div class="emoji">⚠️</div>
          Could not load deadlines.<br>Try refreshing.
        </div>`;
      return;
    }

    // Filter out snoozed deadlines from all buckets
    const now = new Date().toISOString();
    for (const key of Object.keys(buckets)) {
      buckets[key] = buckets[key].filter(d => {
        if (d.snoozedUntil && d.snoozedUntil > now) return false;
        return true;
      });
    }

    // Separate "confirm" status items into their own section
    const confirmItems = [];
    for (const key of Object.keys(buckets)) {
      buckets[key] = buckets[key].filter(d => {
        if (d.status === 'confirm') {
          confirmItems.push(d);
          return false;
        }
        return true;
      });
    }

    const allItems = Object.values(buckets).flat();
    const total = allItems.length + confirmItems.length;

    if (total === 0) {
      content.innerHTML = `
        <div class="state-msg">
          <div class="emoji">✅</div>
          No deadlines found yet.<br>
          <span style="color:#444">Open emails in Gmail or click Scan to start tracking.</span>
        </div>`;
      updateStats();
      return;
    }

    content.innerHTML =
      buildSection('Overdue', 'dot-overdue', buckets.overdue || []) +
      buildSection('Today', 'dot-today', buckets.today || []) +
      buildSection('This week', 'dot-week', buckets.thisWeek || []) +
      buildSection('Later', 'dot-later', buckets.later || []) +
      buildSection('No date found', 'dot-nodate', buckets.noDate || []) +
      buildSection('Needs Review', 'dot-confirm', confirmItems, true);

    updateStats();
  });
}

// ── Scan status ────────────────────────────────────────────────────

function updateScanStatus() {
  chrome.runtime.sendMessage({ type: 'GET_SCAN_STATUS' }, (status) => {
    if (chrome.runtime.lastError || !status) {
      scanStatusText.textContent = 'Scan status unavailable';
      return;
    }

    if (status.lastScanTime) {
      scanStatusText.textContent = `Last scanned: ${formatTimeAgo(status.lastScanTime)}`;
    } else {
      scanStatusText.textContent = 'Not yet scanned';
    }

    if (status.lastScanResults?.newDeadlines > 0) {
      scanNewCount.textContent = `+${status.lastScanResults.newDeadlines} new`;
      scanNewCount.style.display = 'inline';
    } else {
      scanNewCount.style.display = 'none';
    }
  });
}

// ── Stats footer ───────────────────────────────────────────────────

function updateStats() {
  chrome.runtime.sendMessage({ type: 'GET_DEADLINES' }, (buckets) => {
    if (chrome.runtime.lastError || !buckets) return;

    const all = Object.values(buckets).flat();
    const total = all.length;
    const done = all.filter(d => d.status === 'done').length;

    // Count upcoming this week
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    const upcoming = all.filter(d => {
      if (!d.deadline) return false;
      const dl = new Date(d.deadline);
      return dl >= new Date() && dl < weekEnd && d.status !== 'done' && d.status !== 'dismissed';
    }).length;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statCompleted').textContent = done;
    document.getElementById('statUpcoming').textContent = upcoming;
  });
}

// ── Calendar auth ──────────────────────────────────────────────────

function checkCalendarAuth() {
  chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
    if (chrome.runtime.lastError) return;

    const banner = document.getElementById('authBanner');
    const status = document.getElementById('authStatus');

    if (response?.authenticated) {
      if (banner) banner.style.display = 'none';
      if (status) {
        status.textContent = '✓ Calendar connected';
        status.style.color = '#4ade80';
      }
    } else {
      if (banner) banner.style.display = 'flex';
      if (status) {
        status.textContent = 'Gmail deadline tracker';
        status.style.color = '';
      }
    }
  });
}

function syncAllPending() {
  chrome.storage.local.get('deadlines', (data) => {
    const deadlines = data.deadlines || [];
    const pending = deadlines.filter(d =>
      (d.status === 'pending' || d.status === 'synced') && !d.calendarEventId
    );

    if (pending.length === 0) return;
    console.log('[Popup] Syncing', pending.length, 'deadlines to calendar...');

    pending.forEach(d => {
      chrome.runtime.sendMessage(
        { type: 'SYNC_TO_CALENDAR', deadlineId: d.id },
        () => render()
      );
    });
  });
}

// ── Scan Now button ────────────────────────────────────────────────

scanBtn.addEventListener('click', () => {
  scanBtn.disabled = true;
  scanBtn.textContent = '⏳ Scanning...';
  scanStatusText.innerHTML = '<span class="scan-spinner"></span> Scanning inbox...';

  chrome.runtime.sendMessage({ type: 'SCAN_INBOX' }, (result) => {
    scanBtn.disabled = false;
    scanBtn.textContent = '🔍 Scan';

    if (chrome.runtime.lastError || !result) {
      scanStatusText.textContent = 'Scan failed';
      return;
    }

    if (result.error === 'not_authenticated') {
      scanStatusText.textContent = 'Connect your account first ↓';
      return;
    }

    scanStatusText.textContent = `Scanned ${result.scanned} emails`;
    if (result.newDeadlines > 0) {
      scanNewCount.textContent = `+${result.newDeadlines} new`;
      scanNewCount.style.display = 'inline';
    }

    render();
    setTimeout(updateScanStatus, 2000);
  });
});

// Connect button click
const connectBtn = document.getElementById('connectCalBtn');
if (connectBtn) {
  connectBtn.addEventListener('click', () => {
    connectBtn.textContent = 'Connecting...';
    connectBtn.disabled = true;

    chrome.runtime.sendMessage({ type: 'AUTHENTICATE_CALENDAR' }, (response) => {
      if (chrome.runtime.lastError) {
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;
        return;
      }

      if (response?.success) {
        checkCalendarAuth();
        syncAllPending();
      } else {
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;
        alert('Calendar connection failed.\n\n' + (response?.error || 'Unknown error'));
      }
    });
  });
}

// ── Event delegation ───────────────────────────────────────────────

content.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action], [data-url]');
  if (!btn) return;

  // Open email in new tab
  if (btn.dataset.url) {
    chrome.tabs.create({ url: btn.dataset.url });
    return;
  }

  const { action, id } = btn.dataset;
  if (!action || !id) return;

  // Mark done or dismiss
  if (action === 'done' || action === 'dismiss') {
    chrome.runtime.sendMessage(
      { type: 'UPDATE_STATUS', id, status: action === 'done' ? 'done' : 'dismissed' },
      () => render()
    );
    return;
  }

  // Confirm a low-confidence deadline (move from confirm → pending)
  if (action === 'confirm') {
    chrome.runtime.sendMessage(
      { type: 'UPDATE_STATUS', id, status: 'pending' },
      () => render()
    );
    return;
  }

  // Snooze for 24 hours
  if (action === 'snooze') {
    chrome.runtime.sendMessage(
      { type: 'SNOOZE_DEADLINE', id, hours: 24 },
      () => render()
    );
    return;
  }

  // Sync individual deadline to Google Calendar
  if (action === 'sync') {
    btn.textContent = 'Syncing...';
    btn.disabled = true;

    chrome.runtime.sendMessage(
      { type: 'SYNC_TO_CALENDAR', deadlineId: id },
      (result) => {
        if (chrome.runtime.lastError) {
          btn.textContent = '📅 Add to Cal';
          btn.disabled = false;
          return;
        }

        if (result?.created) {
          render();
        } else if (result?.reason === 'already_exists') {
          render();
        } else {
          btn.textContent = '📅 Add to Cal';
          btn.disabled = false;

          if (result?.error?.includes('Not authenticated') ||
              result?.reason === 'not_authenticated') {
            alert('Please connect your Google Calendar first using the banner above.');
          } else {
            console.warn('[Popup] Sync failed:', result);
          }
        }
      }
    );
    return;
  }
});

// ── Toolbar controls ───────────────────────────────────────────────

document.getElementById('refreshBtn').addEventListener('click', () => {
  render();
  updateScanStatus();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('Clear all tracked deadlines? This cannot be undone.')) {
    chrome.runtime.sendMessage({ type: 'CLEAR_ALL' }, () => render());
  }
});

// ── Init ───────────────────────────────────────────────────────────
render();
checkCalendarAuth();
updateScanStatus();