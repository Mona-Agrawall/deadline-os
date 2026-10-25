const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadServiceWorker, createFakeFetch, flush, plain } = require('./helpers/load-extension');
const { gmailMessage, gmailRoutes } = require('./helpers/gmail-fixtures');

const NOW = new Date(2027, 2, 10, 10, 0);

function setup(messages = []) {
  const fake = createFakeFetch(gmailRoutes(messages));
  return loadServiceWorker({ now: NOW, fetch: fake.fetch });
}

// The email as the content script would send it after opening it in Gmail
const OPENED_EMAIL = {
  subject: 'Assignment submission deadline',
  sender: { name: 'TA', email: 'ta@uni.edu' },
  body: 'Submit by 2 April 2027 5:00 PM. The assignment submission portal closes then.',
  receivedDate: 'Mar 10, 2027, 9:00 AM',
  url: 'https://mail.google.com/mail/u/0/#inbox/FMfcgz123',
};

test('installing the extension schedules the background alarms', () => {
  const { state } = setup();
  state.listeners.installed.forEach(listener => listener({ reason: 'install' }));
  assert.deepEqual(plain(state.alarms), {
    'deadlineos-poll': { delayInMinutes: 1, periodInMinutes: 30 },
    'deadlineos-cleanup': { delayInMinutes: 5, periodInMinutes: 1440 },
    'deadlineos-retry': { delayInMinutes: 2, periodInMinutes: 10 },
  });
});

test('an opened email is saved once, with reminders', async () => {
  const { sendMessage, state } = setup();

  const first = await sendMessage({ type: 'EMAIL_OPENED', payload: OPENED_EMAIL });
  assert.equal(first.status, 'saved');
  assert.equal(first.deadline.source, 'dom');
  assert.equal(first.deadline.emailUrl, OPENED_EMAIL.url);

  const again = await sendMessage({ type: 'EMAIL_OPENED', payload: OPENED_EMAIL });
  assert.equal(again.status, 'duplicate');

  const ignored = await sendMessage({ type: 'EMAIL_OPENED', payload: { ...OPENED_EMAIL, subject: 'hi', body: 'just saying hi' } });
  assert.equal(ignored.status, 'ignored');

  assert.deepEqual(Object.keys(state.alarms).filter(n => n.startsWith('deadline_')).length, 3);
});

test('the same email opened in Gmail and then found by a scan is stored once', async () => {
  const sameEmailFromApi = gmailMessage({
    id: 'm1',
    from: 'TA <ta@uni.edu>',
    subject: OPENED_EMAIL.subject,
    date: 'Wed, 10 Mar 2027 09:00:00 +0530', // formatted differently from the Gmail page
    body: OPENED_EMAIL.body,
  });
  const { sendMessage } = setup([sameEmailFromApi]);

  await sendMessage({ type: 'EMAIL_OPENED', payload: OPENED_EMAIL });
  const scan = await sendMessage({ type: 'SCAN_INBOX' });
  assert.equal(scan.newDeadlines, 0);
  assert.equal((await sendMessage({ type: 'GET_ALL_DEADLINES' })).length, 1);
});

test('marking done cancels reminders and updates stats', async () => {
  const { sendMessage, state } = setup();
  const { deadline } = await sendMessage({ type: 'EMAIL_OPENED', payload: OPENED_EMAIL });

  assert.equal(await sendMessage({ type: 'UPDATE_STATUS', id: deadline.id, status: 'done' }), true);
  assert.deepEqual(Object.keys(state.alarms), []);
  assert.deepEqual(await sendMessage({ type: 'GET_STATS' }), { total: 1, completedThisWeek: 1, upcomingThisWeek: 0 });
  assert.deepEqual(Object.values(await sendMessage({ type: 'GET_DEADLINES' })).flat(), []);
});

test('snoozing records when the deadline reappears', async () => {
  const { sendMessage } = setup();
  const { deadline } = await sendMessage({ type: 'EMAIL_OPENED', payload: OPENED_EMAIL });
  await sendMessage({ type: 'SNOOZE_DEADLINE', id: deadline.id, hours: 24 });
  const [saved] = await sendMessage({ type: 'GET_ALL_DEADLINES' });
  assert.equal(saved.snoozedUntil, new Date(2027, 2, 11, 10, 0).toISOString());
});

test('saving settings applies them to new emails and to existing reminders', async () => {
  const { sendMessage, state } = setup();
  await sendMessage({ type: 'EMAIL_OPENED', payload: OPENED_EMAIL });

  const saved = await sendMessage({ type: 'SAVE_SETTINGS', settings: { reminderMinutes: [180], dateOrder: 'MDY' } });
  assert.deepEqual(saved.reminderMinutes, [180]);
  assert.deepEqual(Object.keys(state.alarms).filter(n => n.startsWith('deadline_')).map(n => n.split('_').pop()), ['180']);

  const numeric = { ...OPENED_EMAIL, subject: 'Lab submission', body: 'Lab submission deadline 04/05/2027', receivedDate: 'other' };
  const { deadline } = await sendMessage({ type: 'EMAIL_OPENED', payload: numeric });
  assert.equal(new Date(deadline.deadline).getMonth(), 3); // MDY → April 5

  const defaults = await sendMessage({ type: 'RESET_SETTINGS' });
  assert.equal(defaults.dateOrder, 'DMY');
  assert.deepEqual(await sendMessage({ type: 'GET_SETTINGS' }), defaults);
});

test('auth messages report the sign-in state', async () => {
  const { sendMessage, state } = setup();
  assert.deepEqual(await sendMessage({ type: 'CHECK_AUTH' }), { authenticated: true });
  assert.deepEqual(await sendMessage({ type: 'AUTHENTICATE' }), { success: true });
  state.authenticated = false;
  assert.deepEqual(await sendMessage({ type: 'CHECK_AUTH' }), { authenticated: false });
});

test('cleanup and poll alarms run their jobs', async () => {
  const message = gmailMessage({ id: 'm1', from: 'support@hackerrank.com', subject: 'Interview scheduled', body: 'Interview on 15 March 2027' });
  const { fireAlarm, sendMessage } = setup([message]);
  await fireAlarm('deadlineos-poll');
  assert.equal((await sendMessage({ type: 'GET_SCAN_STATUS' })).lastScanResults.newDeadlines, 1);
  await fireAlarm('deadlineos-cleanup'); // nothing old to remove — must not throw
  assert.equal((await sendMessage({ type: 'GET_ALL_DEADLINES' })).length, 1);
});

test('notification buttons are wired to the notifier', async () => {
  const { sendMessage, state } = setup();
  const { deadline } = await sendMessage({ type: 'EMAIL_OPENED', payload: OPENED_EMAIL });

  state.listeners.notificationClick.forEach(l => l(`deadlineos_${deadline.id}_60`));
  state.listeners.notificationButton.forEach(l => l(`deadlineos_${deadline.id}_60`, 1));
  await flush(10);

  assert.deepEqual(state.openedTabs, [OPENED_EMAIL.url]);
  assert.equal((await sendMessage({ type: 'GET_ALL_DEADLINES' }))[0].status, 'done');
});

test('clear all wipes stored data', async () => {
  const { sendMessage, state } = setup();
  await sendMessage({ type: 'EMAIL_OPENED', payload: OPENED_EMAIL });
  assert.deepEqual(await sendMessage({ type: 'CLEAR_ALL' }), { done: true });
  assert.deepEqual(state.storage, {});
});

test('unknown messages are not answered; failures return an error', async () => {
  const { sendMessage, state } = setup();
  assert.equal(await sendMessage({ type: 'NOT_A_MESSAGE' }), undefined);

  state.storage = null; // makes every storage call throw
  const result = await sendMessage({ type: 'GET_ALL_DEADLINES' });
  assert.equal(result.status, 'error');
});
