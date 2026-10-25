const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadServiceWorker, createFakeFetch, plain } = require('./helpers/load-extension');
const { ACCOUNT_EMAIL, gmailMessage, gmailRoutes } = require('./helpers/gmail-fixtures');

const NOW = new Date(2027, 2, 10, 10, 0);

function setup(messages, options) {
  const calendarEvents = [];
  const fake = createFakeFetch(gmailRoutes(messages, { calendarEvents, ...options }));
  const sw = loadServiceWorker({ now: NOW, fetch: fake.fetch });
  return { ...sw, requests: fake.requests, calendarEvents, GmailScanner: sw.get('GmailScanner'), Storage: sw.get('Storage') };
}

const INTERVIEW = gmailMessage({
  id: 'm1',
  from: 'HackerRank Team <support@hackerrank.com>',
  subject: 'Interview scheduled: Technical round',
  body: 'Your technical round interview is scheduled for 15 March 2027 at 3:00 PM.',
});

test('saves deadlines found in the inbox and reports counts', async () => {
  const messages = [
    INTERVIEW,
    gmailMessage({ id: 'm2', from: 'LinkedIn <jobs@linkedin.com>', subject: 'Apply by Friday', body: 'Apply by Friday' }),
    gmailMessage({ id: 'm3', from: 'Shop <info@shop.com>', subject: 'Order confirmation', body: 'Thanks' }),
    gmailMessage({ id: 'm4', from: 'hr@acme.io', subject: 'Interview feedback', body: 'No dates in this one.' }),
  ];
  const { GmailScanner, Storage } = setup(messages);

  const results = plain(await GmailScanner.scanInbox());
  delete results.scanTime;
  assert.deepEqual(results, { success: true, scanned: 4, newDeadlines: 1, duplicates: 0, ignored: 3, errors: 0 });

  const [saved] = plain(await Storage.getAllDeadlines());
  assert.equal(saved.subject, 'Interview scheduled: Technical round');
  assert.equal(saved.senderName, 'HackerRank Team');
  assert.equal(saved.source, 'gmail_api');
  assert.equal(saved.status, 'synced'); // high confidence → added to calendar
  assert.equal(saved.deadline, new Date(2027, 2, 15, 15, 0).toISOString());
});

test('links point to the right Gmail account and thread', async () => {
  const { GmailScanner, Storage } = setup([INTERVIEW]);
  await GmailScanner.scanInbox();
  const [saved] = await Storage.getAllDeadlines();
  assert.equal(saved.emailUrl, `https://mail.google.com/mail/u/${ACCOUNT_EMAIL}/#all/thread-m1`);
});

test('searches recent, relevant inbox mail with exact phrases', async () => {
  const { GmailScanner, requests } = setup([]);
  await GmailScanner.scanInbox();

  const list = requests.find(r => r.url.includes('/messages?'));
  assert.match(list.url, /maxResults=30/);
  assert.match(list.url, /in:inbox newer_than:7d -category:promotions/);
  assert.match(list.url, /-from:noreply@linkedin\.com/);
  assert.match(list.url, /\{interview "interview scheduled" .* "urgent reminder"\}/);
});

test('reads HTML-only and nested multipart emails, including non-English text', async () => {
  const messages = [
    gmailMessage({ id: 'h', from: 'exams@srmist.edu.in', subject: 'CIA exam schedule', body: 'परीक्षा — submission deadline 25 March 2027', format: 'html' }),
    gmailMessage({ id: 'n', from: 'exams@srmist.edu.in', subject: 'Lab evaluation', body: 'Lab evaluation on 20 March 2027', format: 'nested' }),
  ];
  const { GmailScanner, Storage } = setup(messages);
  await GmailScanner.scanInbox();

  const saved = plain(await Storage.getAllDeadlines());
  assert.deepEqual(saved.map(d => d.deadlineRaw).sort(), ['20 March 2027', '25 March 2027']);
});

test('trusted senders skip the pre-filter that drops other no-reply senders', async () => {
  // A no-reply sender with no "important" subject words is normally skipped unparsed
  const fromCollege = gmailMessage({
    id: 'c', from: 'noreply@srmist.edu.in', subject: 'End sem timetable', body: 'End sem from 25 March 2027',
  });
  const { GmailScanner, Storage } = setup([fromCollege]);
  await GmailScanner.scanInbox();
  assert.equal((await Storage.getAllDeadlines()).length, 1);
});

test('a second scan finds only duplicates', async () => {
  const { GmailScanner } = setup([INTERVIEW]);
  await GmailScanner.scanInbox();
  const second = await GmailScanner.scanInbox();
  assert.equal(second.newDeadlines, 0);
  assert.equal(second.duplicates, 1);
});

test('scans started while one is running share it', async () => {
  const { GmailScanner, requests } = setup([INTERVIEW]);
  const [a, b] = await Promise.all([GmailScanner.scanInbox(), GmailScanner.scanInbox()]);
  assert.equal(a, b);
  assert.equal(requests.filter(r => r.url.includes('/messages?')).length, 1);
});

test('a message that fails to load is counted as an error without stopping the scan', async () => {
  const { GmailScanner } = setup([INTERVIEW], { failingIds: ['bad'] });
  const results = await GmailScanner.scanInbox();
  assert.equal(results.errors, 1);
  assert.equal(results.newDeadlines, 1);
});

test('signed out: no requests, a clear error', async () => {
  const { GmailScanner, state, requests } = setup([INTERVIEW]);
  state.authenticated = false;
  assert.equal((await GmailScanner.scanInbox()).error, 'not_authenticated');
  assert.equal(requests.length, 0);
});

test('scan status is saved for the popup', async () => {
  const { GmailScanner } = setup([INTERVIEW]);
  assert.deepEqual(plain(await GmailScanner.getScanStatus()), { lastScanTime: null, lastScanResults: null });
  await GmailScanner.scanInbox();
  const status = plain(await GmailScanner.getScanStatus());
  assert.equal(status.lastScanTime, NOW.toISOString());
  assert.equal(status.lastScanResults.newDeadlines, 1);
});
