const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadServiceWorker } = require('./helpers/load-extension');

function setup() {
  const sw = loadServiceWorker();
  return { ...sw, Deduplicator: sw.get('Deduplicator') };
}

const email = (fields = {}) => ({
  subject: 'Interview scheduled',
  sender: { email: 'hr@acme.io' },
  receivedDate: 'Mon, 8 Mar 2027 09:00:00 +0530',
  ...fields,
});

test('the same email always gets the same fingerprint', () => {
  const { Deduplicator } = setup();
  const id = Deduplicator.fingerprint(email());
  assert.match(id, /^dl_[0-9a-f]{8}$/);
  assert.equal(Deduplicator.fingerprint(email({ subject: '  INTERVIEW   scheduled ' })), id);
});

test('different emails get different fingerprints', () => {
  const { Deduplicator } = setup();
  const ids = new Set([
    Deduplicator.fingerprint(email()),
    Deduplicator.fingerprint(email({ subject: 'Other' })),
    Deduplicator.fingerprint(email({ sender: { email: 'other@acme.io' } })),
    Deduplicator.fingerprint(email({ receivedDate: 'Tue, 9 Mar 2027' })),
  ]);
  assert.equal(ids.size, 4);
});

test('remembers processed ids', async () => {
  const { Deduplicator } = setup();
  assert.equal(await Deduplicator.isDuplicate('dl_1'), false);
  await Deduplicator.markProcessed('dl_1');
  await Deduplicator.markProcessed('dl_1');
  assert.equal(await Deduplicator.isDuplicate('dl_1'), true);
});

test('keeps only the newest 1000 ids, even with concurrent writes', async () => {
  const { Deduplicator, state } = setup();
  await Promise.all(Array.from({ length: 1005 }, (_, i) => Deduplicator.markProcessed(`dl_${i}`)));

  assert.equal(state.storage.processed_ids.length, 1000);
  assert.equal(await Deduplicator.isDuplicate('dl_4'), false);
  assert.equal(await Deduplicator.isDuplicate('dl_5'), true);
  assert.equal(await Deduplicator.isDuplicate('dl_1004'), true);
});
