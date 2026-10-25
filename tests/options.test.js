const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, readSource, flush } = require('./helpers/load-extension');

const STORED = {
  dateOrder: 'DMY',
  reminderMinutes: [1440, 60],
  collegeDomains: ['srmist.edu.in', 'srm.edu.in'],
  careerDomains: ['haveloc.com'],
};

function openOptions(responses = {}) {
  const handlers = {
    GET_SETTINGS: STORED,
    SAVE_SETTINGS: ({ settings }) => ({ ...settings, collegeDomains: settings.collegeDomains.filter(d => d.includes('.')) }),
    RESET_SETTINGS: { ...STORED, dateOrder: 'DMY', reminderMinutes: [1440, 60, 15] },
    ...responses,
  };
  return loadPage({
    html: readSource('options/options.html'),
    url: 'chrome-extension://test-id/options/options.html',
    scripts: ['options/options.js'],
    handleMessage: (message) => {
      const handler = handlers[message.type];
      return typeof handler === 'function' ? handler(message) : handler;
    },
  });
}

const checkedReminders = doc =>
  [...doc.querySelectorAll('[name="reminderMinutes"]:checked')].map(c => Number(c.value));

test('loads the saved settings into the form', async () => {
  const page = openOptions();
  await flush(10);
  const form = page.document.getElementById('settingsForm');

  assert.equal(form.elements.dateOrder.value, 'DMY');
  assert.deepEqual(checkedReminders(page.document), [1440, 60]);
  assert.equal(form.elements.collegeDomains.value, 'srmist.edu.in\nsrm.edu.in');
  assert.equal(form.elements.careerDomains.value, 'haveloc.com');
});

test('saving sends the form values and shows the cleaned result', async () => {
  const page = openOptions();
  await flush(10);
  const doc = page.document;
  const form = doc.getElementById('settingsForm');

  doc.querySelector('[name="dateOrder"][value="MDY"]').checked = true;
  doc.querySelector('[name="reminderMinutes"][value="15"]').checked = true;
  form.elements.collegeDomains.value = 'myuni.edu\n\n  not-a-domain  \n';
  form.querySelector('[type="submit"]').click();
  await flush(10);

  const saved = page.sentMessages.find(m => m.type === 'SAVE_SETTINGS').settings;
  assert.deepEqual(saved, {
    dateOrder: 'MDY',
    reminderMinutes: [1440, 60, 15],
    collegeDomains: ['myuni.edu', 'not-a-domain'],
    careerDomains: ['haveloc.com'],
  });
  assert.equal(form.elements.collegeDomains.value, 'myuni.edu'); // invalid entry removed by the service worker
  assert.equal(doc.getElementById('status').textContent, '✓ Saved');
});

test('reset restores defaults', async () => {
  const page = openOptions();
  await flush(10);
  page.document.getElementById('resetBtn').click();
  await flush(10);
  assert.deepEqual(checkedReminders(page.document), [1440, 60, 15]);
  assert.equal(page.document.getElementById('status').textContent, '✓ Defaults restored');
});

test('shows an error if settings cannot be loaded or saved', async () => {
  const page = openOptions({ GET_SETTINGS: null, SAVE_SETTINGS: null });
  await flush(10);
  const status = page.document.getElementById('status');
  assert.equal(status.textContent, 'Could not load settings.');
  assert.ok(status.classList.contains('error'));
});
