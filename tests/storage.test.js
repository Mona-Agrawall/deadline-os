const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadServiceWorker, plain } = require('./helpers/load-extension');

const NOW = new Date(2027, 2, 10, 10, 0); // Wednesday 10 March 2027, 10:00

function setup() {
  const sw = loadServiceWorker({ now: NOW });
  return { ...sw, Storage: sw.get('Storage') };
}

const at = (day, hour = 23, minute = 59) => new Date(2027, 2, day, hour, minute).toISOString();

function deadline(id, fields = {}) {
  return {
    id,
    subject: `Subject ${id}`,
    senderEmail: `${id}@example.com`,
    deadline: null,
    status: 'pending',
    savedAt: NOW.toISOString(),
    ...fields,
  };
}

test('saves deadlines sorted soonest first, undated last', async () => {
  const { Storage } = setup();
  await Storage.saveDeadline(deadline('c'));
  await Storage.saveDeadline(deadline('b', { deadline: at(20) }));
  await Storage.saveDeadline(deadline('a', { deadline: at(12) }));
  assert.deepEqual(plain(await Storage.getAllDeadlines()).map(d => d.id), ['a', 'b', 'c']);
});

test('rejects a deadline with the same id', async () => {
  const { Storage } = setup();
  assert.equal((await Storage.saveDeadline(deadline('a'))).saved, true);
  assert.equal((await Storage.saveDeadline(deadline('a', { subject: 'Other' }))).saved, false);
});

test('rejects the same email arriving by another route (same subject, sender, deadline)', async () => {
  const { Storage } = setup();
  await Storage.saveDeadline(deadline('dom-id', { subject: 'Fee  Due', senderEmail: 'A@x.com', deadline: at(12) }));
  const result = await Storage.saveDeadline(deadline('api-id', { subject: 'fee due', senderEmail: 'a@x.com', deadline: at(12) }));
  assert.equal(result.saved, false);
});

test('concurrent saves never lose each other\'s writes', async () => {
  const { Storage } = setup();
  await Promise.all(Array.from({ length: 20 }, (_, i) => Storage.saveDeadline(deadline(`d${i}`))));
  assert.equal((await Storage.getAllDeadlines()).length, 20);
});

test('updates status (with timestamp) and snoozes', async () => {
  const { Storage } = setup();
  await Storage.saveDeadline(deadline('a'));

  assert.equal(await Storage.updateDeadlineStatus('a', 'done'), true);
  assert.equal(await Storage.snoozeDeadline('a', 2), true);
  assert.equal(await Storage.updateDeadlineStatus('missing', 'done'), false);

  const saved = plain(await Storage.getDeadline('a'));
  assert.equal(saved.status, 'done');
  assert.equal(saved.updatedAt, NOW.toISOString());
  assert.equal(saved.snoozedUntil, new Date(2027, 2, 10, 12, 0).toISOString());
});

test('groups active deadlines into time buckets', async () => {
  const { Storage } = setup();
  await Storage.saveDeadline(deadline('overdue', { deadline: at(9) }));
  await Storage.saveDeadline(deadline('today', { deadline: at(10, 18) }));
  await Storage.saveDeadline(deadline('week', { deadline: at(15) }));
  await Storage.saveDeadline(deadline('later', { deadline: at(30) }));
  await Storage.saveDeadline(deadline('nodate'));
  await Storage.saveDeadline(deadline('done', { deadline: at(15), status: 'done' }));

  const buckets = plain(await Storage.getDeadlinesByBucket());
  const ids = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.map(d => d.id)]));
  assert.deepEqual(ids, { overdue: ['overdue'], today: ['today'], thisWeek: ['week'], later: ['later'], noDate: ['nodate'] });
});

test('computes footer stats', async () => {
  const { Storage } = setup();
  await Storage.saveDeadline(deadline('upcoming', { deadline: at(12) }));
  await Storage.saveDeadline(deadline('far', { deadline: at(30) }));
  await Storage.saveDeadline(deadline('done', { status: 'done', updatedAt: NOW.toISOString() }));
  await Storage.saveDeadline(deadline('dismissed', { status: 'dismissed' }));

  // Week runs Sunday 7 March → Sunday 14 March
  assert.deepEqual(plain(await Storage.getStats()), { total: 3, completedThisWeek: 1, upcomingThisWeek: 1 });
});

test('cleanup removes only old done/dismissed deadlines', async () => {
  const { Storage } = setup();
  const old = new Date(2027, 0, 1).toISOString();
  await Storage.saveDeadline(deadline('old-done', { status: 'done', updatedAt: old }));
  await Storage.saveDeadline(deadline('recent-done', { status: 'done', updatedAt: NOW.toISOString() }));
  await Storage.saveDeadline(deadline('old-active', { savedAt: old }));

  await Storage.cleanupOldEntries();
  assert.deepEqual(plain(await Storage.getAllDeadlines()).map(d => d.id).sort(), ['old-active', 'recent-done']);
});

test('clearAll empties storage', async () => {
  const { Storage, state } = setup();
  await Storage.saveDeadline(deadline('a'));
  await Storage.clearAll();
  assert.deepEqual(state.storage, {});
});
