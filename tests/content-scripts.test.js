const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, flush } = require('./helpers/load-extension');

// The content scripts start after Gmail has had time to render (≈2 s)
const STARTUP_MS = 2300;

const inDays = n => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

const SAVED_DEADLINES = [
  { id: 'dl_1', subject: 'Interview scheduled: Technical round', category: 'INTERVIEW', deadline: inDays(3), deadlineRaw: '15 March', status: 'pending' },
  { id: 'dl_2', subject: 'Fee due', category: 'PAYMENT', deadline: inDays(-1), status: 'pending' },
  { id: 'dl_3', subject: 'Old done task', category: 'EVENT', deadline: inDays(2), status: 'done' },
];

const GMAIL_INBOX = `<!DOCTYPE html><html><head></head><body>
  <div class="AO">
    <table>
      <tr class="zA"><td><span class="bog">Interview scheduled: Technical round</span></td></tr>
      <tr class="zA"><td><span class="bog">FEE   due</span></td></tr>
      <tr class="zA"><td><span class="bog">Old done task</span></td></tr>
      <tr class="zA"><td><span class="bog">Interview scheduled: Technical round — updated</span></td></tr>
      <tr class="zA"><td><span class="bog">Unrelated newsletter</span></td></tr>
    </table>
    <div id="reading-pane"></div>
  </div>
</body></html>`;

function openGmail({ failFirstSend = false } = {}) {
  let failNext = failFirstSend;
  const page = loadPage({
    html: GMAIL_INBOX,
    url: 'https://mail.google.com/mail/u/0/#inbox',
    scripts: ['utils/categories.js', 'content/email-extractor.js', 'content/gmail-observer.js', 'content/badge-injector.js'],
    handleMessage: (message) => {
      if (message.type === 'GET_ALL_DEADLINES') return SAVED_DEADLINES;
      if (message.type === 'EMAIL_OPENED') return { status: 'saved' };
      return null;
    },
  });

  // Simulate the service worker not being ready for the first message
  const send = page.chrome.runtime.sendMessage;
  page.chrome.runtime.sendMessage = (message, callback) => {
    if (message.type === 'EMAIL_OPENED' && failNext) {
      failNext = false;
      page.sentMessages.push(JSON.parse(JSON.stringify(message)));
      page.chrome.runtime.lastError = { message: 'Could not establish connection.' };
      callback(undefined);
      page.chrome.runtime.lastError = undefined;
      return;
    }
    send(message, callback);
  };
  return page;
}

function openEmail(page, hash = '#inbox/FMfcgz123') {
  page.document.getElementById('reading-pane').innerHTML = `
    <h2 class="hP">Assignment submission deadline</h2>
    <span class="gD" name="TA" email="ta@uni.edu">TA</span>
    <span class="g3" title="Mar 10, 2027, 9:00 AM">9:00 AM</span>
    <div class="a3s aiL">Submit by 2 April 2027 5:00 PM.</div>`;
  page.window.location.hash = hash;
}

const openedMessages = page => page.sentMessages.filter(m => m.type === 'EMAIL_OPENED');

test('badges appear only on rows whose subject exactly matches an active deadline', async (t) => {
  const page = openGmail();
  t.after(page.close);
  await flush(STARTUP_MS);

  const badges = [...page.document.querySelectorAll('.deadlineos-badge')];
  assert.deepEqual(badges.map(b => [b.previousElementSibling.textContent, b.textContent]), [
    ['Interview scheduled: Technical round', '🎯 Interview'],
    ['FEE   due', '💳 Payment'],
  ]);
  assert.ok(badges[0].classList.contains('urgency-week'));
  assert.ok(badges[1].classList.contains('urgency-overdue'));
  assert.equal(badges[0].title, 'Deadline OS: INTERVIEW — 15 March');
});

test('nothing is sent while the inbox list is showing', async (t) => {
  const page = openGmail();
  t.after(page.close);
  await flush(STARTUP_MS);
  assert.equal(openedMessages(page).length, 0);
});

test('opening an email sends its details once, retrying if the service worker is asleep', async (t) => {
  const page = openGmail({ failFirstSend: true });
  t.after(page.close);
  await flush(500);
  openEmail(page);
  await flush(1600);

  const sent = openedMessages(page);
  assert.equal(sent.length, 2); // first attempt failed, retry succeeded
  assert.deepEqual(sent[0].payload, {
    subject: 'Assignment submission deadline',
    sender: { name: 'TA', email: 'ta@uni.edu' },
    body: 'Submit by 2 April 2027 5:00 PM.',
    receivedDate: 'Mar 10, 2027, 9:00 AM',
    url: 'https://mail.google.com/mail/u/0/#inbox/FMfcgz123',
  });

  // More DOM changes on the same email don't resend it
  page.document.getElementById('reading-pane').append(page.document.createElement('div'));
  await flush(1500);
  assert.equal(openedMessages(page).length, 2);
});
