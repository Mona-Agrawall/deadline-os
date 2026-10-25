const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadServiceWorker, createFakeFetch, plain } = require('./helpers/load-extension');

const NOW = new Date(2027, 2, 10, 10, 0);

function setup(routes) {
  const fake = createFakeFetch(routes);
  const sw = loadServiceWorker({ now: NOW, fetch: fake.fetch });
  return { ...sw, requests: fake.requests, Storage: sw.get('Storage'), CalendarSync: sw.get('CalendarSync'), Auth: sw.get('Auth') };
}

const noExistingEvent = [(url) => url.includes('iCalUID='), () => ({ body: { items: [] } })];
const createsEvent = [(url, r) => r.method === 'POST', () => ({ body: { id: 'event-1', htmlLink: 'https://cal/event-1' } })];

function deadline(fields = {}) {
  return {
    id: 'dl_1',
    subject: 'CIA exam',
    senderName: 'Exam Cell',
    senderEmail: 'exams@srmist.edu.in',
    category: 'ASSIGNMENT',
    urgency: 'NORMAL',
    score: 0.8,
    deadline: new Date(2027, 2, 25, 23, 59).toISOString(),
    deadlineRaw: '25th March 2027',
    emailUrl: 'https://mail.google.com/mail/u/0/#all/abc',
    status: 'pending',
    calendarEventId: null,
    ...fields,
  };
}

test('creates a 30-minute event ending at the deadline and records it', async () => {
  const { Storage, CalendarSync, requests } = setup([noExistingEvent, createsEvent]);
  await Storage.saveDeadline(deadline());

  const result = plain(await CalendarSync.syncDeadline('dl_1'));
  assert.equal(result.created, true);

  const event = requests.find(r => r.method === 'POST').body;
  assert.equal(event.summary, '📝 CIA exam');
  assert.equal(event.end.dateTime, new Date(2027, 2, 25, 23, 59).toISOString());
  assert.equal(event.start.dateTime, new Date(2027, 2, 25, 23, 29).toISOString());
  assert.equal(event.iCalUID, 'deadlineos-dl_1@gmail.deadline');
  assert.deepEqual(event.reminders.overrides.map(r => r.minutes), [1440, 60]);
  assert.match(event.description, /Original date text: "25th March 2027"/);
  assert.equal(requests[0].headers.Authorization, 'Bearer test-token');

  const saved = plain(await Storage.getDeadline('dl_1'));
  assert.equal(saved.calendarEventId, 'event-1');
  assert.equal(saved.calendarLink, 'https://cal/event-1');
  assert.equal(saved.status, 'synced');
});

test('a deadline without a date becomes an all-day review event for today', async () => {
  const { Storage, CalendarSync, requests } = setup([noExistingEvent, createsEvent]);
  await Storage.saveDeadline(deadline({ deadline: null }));
  await CalendarSync.syncDeadline('dl_1');

  const event = requests.find(r => r.method === 'POST').body;
  assert.equal(event.summary, '📝 [Review] CIA exam');
  assert.deepEqual(event.start, { date: '2027-03-10' });
  assert.deepEqual(event.end, { date: '2027-03-11' }); // end date is exclusive
});

test('an event that already exists in the calendar is linked, not duplicated', async () => {
  const existing = [(url) => url.includes('iCalUID='), () => ({ body: { items: [{ id: 'old-event', htmlLink: 'https://cal/old' }] } })];
  const { Storage, CalendarSync, requests } = setup([existing]);
  await Storage.saveDeadline(deadline());

  const result = plain(await CalendarSync.syncDeadline('dl_1'));
  assert.equal(result.reason, 'already_exists');
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
  assert.equal((await Storage.getDeadline('dl_1')).calendarEventId, 'old-event');
});

test('reports why a sync could not happen', async () => {
  const { Storage, CalendarSync, state } = setup([]);
  await Storage.saveDeadline(deadline({ id: 'dl_synced', calendarEventId: 'e' }));

  assert.equal((await CalendarSync.syncDeadline('missing')).reason, 'deadline_not_found');
  assert.equal((await CalendarSync.syncDeadline('dl_synced')).reason, 'already_synced');
  state.authenticated = false;
  assert.equal((await CalendarSync.syncDeadline('dl_synced')).reason, 'not_authenticated');
});

test('a failed sync is queued and retried until it succeeds', async () => {
  let failures = 1;
  const flaky = [(url, r) => r.method === 'POST', () => {
    if (failures-- > 0) return { status: 500, body: { error: { message: 'Backend Error' } } };
    return { body: { id: 'event-1', htmlLink: 'https://cal/event-1' } };
  }];
  const { Storage, CalendarSync, state, fireAlarm } = setup([noExistingEvent, flaky]);
  await Storage.saveDeadline(deadline());

  const result = plain(await CalendarSync.syncDeadline('dl_1'));
  assert.equal(result.error, 'Calendar API 500: Backend Error');
  assert.deepEqual(state.storage.retryQueue.map(i => [i.deadlineId, i.attempts]), [['dl_1', 0]]);

  await fireAlarm('deadlineos-retry');
  assert.deepEqual(state.storage.retryQueue, []);
  assert.equal((await Storage.getDeadline('dl_1')).calendarEventId, 'event-1');
});

test('a sync that keeps failing is dropped after 5 attempts', async () => {
  const alwaysFails = [(url, r) => r.method === 'POST', () => ({ status: 500, body: {} })];
  const { Storage, CalendarSync, state, fireAlarm } = setup([noExistingEvent, alwaysFails]);
  await Storage.saveDeadline(deadline());
  await CalendarSync.syncDeadline('dl_1');

  for (let i = 1; i <= 4; i++) {
    await fireAlarm('deadlineos-retry');
    assert.equal(state.storage.retryQueue[0].attempts, i);
  }
  await fireAlarm('deadlineos-retry');
  assert.deepEqual(state.storage.retryQueue, []);
});

test('an expired token is dropped and the request retried once', async () => {
  let calls = 0;
  const expiresOnce = [() => true, () => (calls++ === 0 ? { status: 401, body: {} } : { body: { ok: true } })];
  const { Auth, state } = setup([expiresOnce]);

  const response = await Auth.authorizedFetch('https://www.googleapis.com/anything');
  assert.equal(response.status, 200);
  assert.equal(state.removedTokens, 1);
  assert.equal(calls, 2);
});

test('authorized requests fail clearly when signed out', async () => {
  const { Auth, state } = setup([]);
  state.authenticated = false;
  await assert.rejects(Auth.authorizedFetch('https://www.googleapis.com/x'), /Not authenticated/);
  assert.deepEqual(plain(await Auth.authenticate()), { success: false, error: 'The user is not signed in.' });
});
