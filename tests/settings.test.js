const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadServiceWorker, plain } = require('./helpers/load-extension');

function setup() {
  const sw = loadServiceWorker();
  return { ...sw, Settings: sw.get('Settings') };
}

test('defaults are used when nothing is saved', async () => {
  const { Settings } = setup();
  const settings = plain(await Settings.get());
  assert.equal(settings.dateOrder, 'DMY');
  assert.deepEqual(settings.reminderMinutes, [1440, 60, 15]);
  assert.ok(settings.collegeDomains.includes('srmist.edu.in'));
  assert.ok(settings.careerDomains.includes('haveloc.com'));
});

test('saving merges with existing settings and persists', async () => {
  const { Settings, state } = setup();
  await Settings.save({ dateOrder: 'MDY' });
  await Settings.save({ reminderMinutes: [30] });

  const settings = plain(await Settings.get());
  assert.equal(settings.dateOrder, 'MDY');
  assert.deepEqual(settings.reminderMinutes, [30]);
  assert.equal(state.storage.settings.dateOrder, 'MDY');
});

test('domains are cleaned up: case, spaces, @, URLs, duplicates and junk', async () => {
  const { Settings } = setup();
  const saved = plain(await Settings.save({
    collegeDomains: ['  MyUni.EDU ', '@myuni.edu', 'https://cs.myuni.edu/path', 'not a domain', ''],
  }));
  assert.deepEqual(saved.collegeDomains, ['myuni.edu', 'cs.myuni.edu']);
});

test('reminder times are de-duplicated, sorted and limited to one week', async () => {
  const { Settings } = setup();
  const saved = plain(await Settings.save({ reminderMinutes: [15, '60', 60, -5, 99999, 1.5] }));
  assert.deepEqual(saved.reminderMinutes, [60, 15]);
});

test('an unknown date order falls back to day-first', async () => {
  const { Settings } = setup();
  assert.equal((await Settings.save({ dateOrder: 'YMD' })).dateOrder, 'DMY');
});

test('reset restores the defaults', async () => {
  const { Settings } = setup();
  await Settings.save({ dateOrder: 'MDY', collegeDomains: [] });
  const reset = plain(await Settings.reset());
  assert.equal(reset.dateOrder, 'DMY');
  assert.ok(reset.collegeDomains.length > 0);
  assert.deepEqual(plain(await Settings.get()), reset);
});
