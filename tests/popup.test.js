const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, readSource, flush } = require('./helpers/load-extension');

const DAY = 24 * 60 * 60 * 1000;
const inDays = n => new Date(Date.now() + n * DAY).toISOString();

const DEADLINES = {
  interview: { id: 'dl_1', subject: 'Interview scheduled', senderName: 'HR', senderEmail: 'a@hackerrank.com', category: 'INTERVIEW', deadline: inDays(3), status: 'pending', emailUrl: 'https://mail/1' },
  exam: { id: 'dl_2', subject: 'CIA exam "schedule" <b>', senderName: 'Exam Cell', senderEmail: 'x@srmist.edu.in', category: 'ASSIGNMENT', deadline: inDays(-2), status: 'synced', calendarEventId: 'e1', calendarLink: 'https://cal/e1', emailUrl: 'https://mail/2' },
  emi: { id: 'dl_3', subject: 'EMI due reminder', senderName: 'Bank', senderEmail: 'b@gmail.com', category: 'PAYMENT', deadline: inDays(20), status: 'confirm', emailUrl: 'https://mail/3' },
  snoozed: { id: 'dl_4', subject: 'Snoozed one', senderEmail: 'c@d.com', category: 'EVENT', deadline: null, status: 'pending', snoozedUntil: inDays(1), emailUrl: 'https://mail/4' },
};

function openPopup({ authenticated = false, responses = {} } = {}) {
  const auth = { authenticated };
  const handlers = {
    GET_DEADLINES: { overdue: [DEADLINES.exam], today: [], thisWeek: [DEADLINES.interview], later: [DEADLINES.emi], noDate: [DEADLINES.snoozed] },
    GET_SETTINGS: { collegeDomains: ['srmist.edu.in'] },
    GET_STATS: { total: 4, completedThisWeek: 1, upcomingThisWeek: 2 },
    GET_SCAN_STATUS: { lastScanTime: new Date(Date.now() - 5 * 60000).toISOString(), lastScanResults: { newDeadlines: 3 } },
    CHECK_AUTH: auth,
    AUTHENTICATE: () => { auth.authenticated = true; return { success: true }; },
    GET_ALL_DEADLINES: Object.values(DEADLINES),
    SYNC_TO_CALENDAR: { synced: false, reason: 'not_authenticated' },
    SCAN_INBOX: { success: true, scanned: 12, newDeadlines: 2 },
    UPDATE_STATUS: true,
    SNOOZE_DEADLINE: true,
    CLEAR_ALL: { done: true },
    ...responses,
  };

  return loadPage({
    html: readSource('popup/popup.html'),
    url: 'chrome-extension://test-id/popup/popup.html',
    scripts: ['utils/sender-domains.js', 'popup/popup.js'],
    handleMessage: (message) => {
      const handler = handlers[message.type];
      return typeof handler === 'function' ? handler(message) : handler;
    },
  });
}

const text = el => el.textContent.replace(/\s+/g, ' ').trim();

test('shows deadlines grouped into sections, hiding snoozed ones', async () => {
  const popup = await openPopup();
  await flush(10);
  const headers = [...popup.document.querySelectorAll('.section-header')].map(text);
  assert.deepEqual(headers, ['Overdue 1', 'This week 1', 'Needs Review 1']);
  assert.ok(!popup.document.body.textContent.includes('Snoozed one'));
});

test('cards show subject safely, days left, sender label and calendar state', async () => {
  const popup = await openPopup();
  await flush(10);
  const doc = popup.document;

  const subjects = [...doc.querySelectorAll('.card-subject')].map(e => e.textContent);
  assert.ok(subjects.includes('CIA exam "schedule" <b>'));
  assert.equal(doc.querySelector('.card-subject b'), null); // HTML in subjects is not rendered

  assert.deepEqual([...doc.querySelectorAll('.card-days')].map(e => `${e.className}:${e.textContent}`),
    ['card-days overdue:2', 'card-days week:3', 'card-days later:20']);
  assert.deepEqual([...doc.querySelectorAll('.card-account')].map(e => e.textContent), ['College', 'Personal']);
  assert.equal(doc.querySelector('.btn-cal-done').getAttribute('href'), 'https://cal/e1');
});

test('"Needs Review" cards offer confirm/reject instead of done/snooze', async () => {
  const popup = await openPopup();
  await flush(10);
  const review = popup.document.querySelector('.card-confirm');
  assert.ok(review.querySelector('[data-action="confirm"]'));
  assert.equal(review.querySelector('[data-action="snooze"]'), null);
  assert.equal(review.querySelector('[data-action="done"]'), null);
});

test('footer stats, scan status and the connect banner are filled in', async () => {
  const popup = await openPopup();
  await flush(10);
  const doc = popup.document;
  assert.deepEqual(['statTotal', 'statCompleted', 'statUpcoming'].map(id => doc.getElementById(id).textContent), ['4', '1', '2']);
  assert.equal(doc.getElementById('scanStatusText').textContent, 'Last scanned: 5 min ago');
  assert.equal(doc.getElementById('scanNewCount').textContent, '+3 new');
  assert.equal(doc.getElementById('authBanner').hidden, false);
});

test('card buttons send the right messages and re-render', async () => {
  const popup = await openPopup();
  await flush(10);
  const click = async (selector) => {
    popup.sentMessages.length = 0;
    popup.document.querySelector(selector).click();
    await flush(10);
    return popup.sentMessages[0];
  };

  assert.deepEqual(await click('.btn-done[data-id="dl_1"]'), { type: 'UPDATE_STATUS', id: 'dl_1', status: 'done' });
  assert.ok(popup.sentMessages.some(m => m.type === 'GET_DEADLINES'));
  assert.deepEqual(await click('.card-dismiss[data-id="dl_1"]'), { type: 'UPDATE_STATUS', id: 'dl_1', status: 'dismissed' });
  assert.deepEqual(await click('[data-action="confirm"]'), { type: 'UPDATE_STATUS', id: 'dl_3', status: 'pending' });
  assert.deepEqual(await click('[data-action="snooze"]'), { type: 'SNOOZE_DEADLINE', id: 'dl_2', hours: 24 });

  popup.document.querySelector('.btn-open').click();
  assert.deepEqual(popup.state.openedTabs, ['https://mail/2']);
});

test('adding to calendar while signed out asks the user to connect', async () => {
  const popup = await openPopup();
  await flush(10);
  const button = popup.document.querySelector('[data-action="sync"]');
  button.click();
  await flush(10);
  assert.equal(popup.state.alerts.length, 1);
  assert.equal(button.textContent, '📅 Add to Cal');
  assert.equal(button.disabled, false);
});

test('connecting the account hides the banner and syncs pending deadlines one by one', async () => {
  const popup = await openPopup();
  await flush(10);
  popup.sentMessages.length = 0;

  popup.document.getElementById('connectCalBtn').click();
  await flush(30);

  assert.equal(popup.sentMessages[0].type, 'AUTHENTICATE');
  assert.equal(popup.document.getElementById('authBanner').hidden, true);
  assert.ok(popup.document.getElementById('authStatus').classList.contains('connected'));
  const synced = popup.sentMessages.filter(m => m.type === 'SYNC_TO_CALENDAR').map(m => m.deadlineId);
  assert.deepEqual(synced, ['dl_1', 'dl_4']); // pending/synced deadlines without an event
});

test('scan button shows results', async () => {
  const popup = await openPopup();
  await flush(10);
  popup.document.getElementById('scanBtn').click();
  await flush(10);
  assert.equal(popup.document.getElementById('scanStatusText').textContent, 'Scanned 12 emails');
  assert.equal(popup.document.getElementById('scanBtn').textContent, '🔍 Scan');
});

test('scan while signed out explains what to do', async () => {
  const popup = await openPopup({ responses: { SCAN_INBOX: { success: false, error: 'not_authenticated' } } });
  await flush(10);
  popup.document.getElementById('scanBtn').click();
  await flush(10);
  assert.equal(popup.document.getElementById('scanStatusText').textContent, 'Connect your account first ↓');
});

test('settings button opens the options page; clear all asks then clears', async () => {
  const popup = await openPopup();
  await flush(10);
  popup.document.getElementById('settingsBtn').click();
  assert.equal(popup.state.optionsOpened, 1);

  popup.document.getElementById('clearBtn').click();
  await flush(10);
  assert.ok(popup.sentMessages.some(m => m.type === 'CLEAR_ALL'));
});

test('empty and error states', async () => {
  const empty = await openPopup({ responses: { GET_DEADLINES: { overdue: [], today: [], thisWeek: [], later: [], noDate: [] } } });
  await flush(10);
  assert.match(empty.document.getElementById('content').textContent, /No deadlines found yet/);

  const broken = await openPopup({ responses: { GET_DEADLINES: null } });
  await flush(10);
  assert.match(broken.document.getElementById('content').textContent, /Could not load deadlines/);
});
