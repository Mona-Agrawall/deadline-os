const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadServiceWorker } = require('./helpers/load-extension');

const NOW = new Date(2027, 2, 10, 10, 0);
const { get } = loadServiceWorker({ now: NOW });
const Parser = get('Parser');
const Scorer = get('Scorer');
const DEFAULT_SETTINGS = get('Settings.DEFAULTS');

function score(subject, body, email, settings = DEFAULT_SETTINGS) {
  const parsed = Parser.parse({ subject, body, sender: { name: 'Sender', email } }, { dateOrder: 'DMY', now: NOW });
  return Scorer.score(parsed, settings);
}

test('a real interview invite from a career platform is saved automatically', () => {
  const result = score(
    'Interview scheduled: Technical round',
    'Your technical round interview is scheduled for 15 March 2027 at 3:00 PM.',
    'support@hackerrank.com'
  );
  assert.equal(result.action, 'auto_save');
  assert.ok(result.score >= 0.72);
});

test('a college exam notice is saved automatically', () => {
  const result = score('CIA exam schedule', 'Submission deadline: 25 March 2027.', 'exams@srmist.edu.in');
  assert.equal(result.action, 'auto_save');
});

test('a medium-confidence payment reminder from a personal address needs review', () => {
  const result = score('Hostel fee payment due', 'Payment due tomorrow. Pay before 5:00 pm.', 'friend@gmail.com');
  assert.equal(result.action, 'confirm');
});

test('newsletters and marketing are ignored even if they mention deadlines', () => {
  const result = score(
    'Jobs you might like',
    'Apply by 20 March. Unsubscribe from these emails.',
    'jobs@linkedin.com'
  );
  assert.equal(result.action, 'ignore');
  assert.equal(result.score, 0);
});

test('emails without any date are ignored', () => {
  assert.equal(score('Interview feedback', 'Thanks for attending the interview.', 'hr@acme.io').action, 'ignore');
});

test('reasons explain the score', () => {
  const { reasons } = score('Interview scheduled', 'Interview on 15 March 2027', 'support@hackerrank.com');
  assert.ok(reasons.some(r => r.startsWith('Strong category match: INTERVIEW')));
  assert.ok(reasons.some(r => r.startsWith('Future date found')));
  assert.ok(reasons.some(r => r === 'Career platform: hackerrank.com'));
});

test('college and career domains come from the user\'s settings', () => {
  const subject = 'Lab evaluation';
  const body = 'Lab evaluation on 15 March 2027.';
  const custom = { ...DEFAULT_SETTINGS, collegeDomains: ['myuni.edu'] };

  const withDefaults = score(subject, body, 'lab@myuni.edu');
  const withCustom = score(subject, body, 'lab@myuni.edu', custom);
  assert.ok(withCustom.score > withDefaults.score);
  assert.ok(withCustom.reasons.includes('College domain: myuni.edu'));
});

test('no-reply senders are penalised unless their domain is trusted', () => {
  const body = 'Interview on 15 March 2027.';
  const untrusted = score('Interview', body, 'noreply@acme.io');
  const trusted = score('Interview', body, 'noreply@hackerrank.com');
  assert.ok(untrusted.reasons.includes('Automated / no-reply sender'));
  assert.ok(!trusted.reasons.includes('Automated / no-reply sender'));
});

test('domain matching is exact or by subdomain, not by suffix text', () => {
  // "dropbox.com" ends with "x.com" (a marketing domain) but is not x.com
  const { reasons } = score('Deadline', 'Due 15 March 2027', 'team@dropbox.com');
  assert.ok(!reasons.some(r => r.startsWith('Marketing sender')));
});
