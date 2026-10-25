const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadServiceWorker } = require('./helpers/load-extension');

const NOW = new Date(2027, 2, 10, 10, 0); // Wednesday 10 March 2027
const { get } = loadServiceWorker({ now: NOW });
const Parser = get('Parser');

function parse(subject, body, { email = 'someone@company.com', dateOrder = 'DMY' } = {}) {
  return Parser.parse({ subject, body, sender: { name: 'Sender', email }, url: 'https://mail/x' }, { dateOrder, now: NOW });
}

test('detects the category with the strongest keyword evidence', () => {
  assert.equal(parse('Interview scheduled', 'Your technical round is on 15 March').category, 'INTERVIEW');
  assert.equal(parse('Hostel fee', 'Fee payment due by 20 March').category, 'PAYMENT');
  assert.equal(parse('Assignment 3', 'Submission deadline: 18 March').category, 'ASSIGNMENT');
  assert.equal(parse('Hello', 'Just checking in').category, 'UNKNOWN');
});

test('weak keywords need at least two hits to count', () => {
  assert.equal(parse('Course', 'See you in class').categoryMatches.ASSIGNMENT?.weakHits, 2);
  assert.equal(parse('Hi', 'About the course').categoryMatches.ASSIGNMENT, undefined);
});

test('detects urgency, most urgent level first', () => {
  assert.equal(parse('Reminder', 'Please respond ASAP').urgency, 'CRITICAL');
  assert.equal(parse('Reminder', 'Due tomorrow').urgency, 'HIGH');
  assert.equal(parse('Reminder', 'Coming up next week').urgency, 'MEDIUM');
  assert.equal(parse('Reminder', 'No rush on this').urgency, 'LOW');
  assert.equal(parse('Reminder', 'Nothing special').urgency, 'NORMAL');
});

test('picks a future date over a past one', () => {
  const parsed = parse('Fee', 'Invoice dated 1 March. Pay before 20 March.');
  assert.equal(parsed.deadlineRaw, '20 March');
  assert.equal(new Date(parsed.deadline).getDate(), 20);
});

test('among future dates, prefers one introduced by deadline wording', () => {
  const parsed = parse('Hackathon', 'Hackathon happens 25 March. Registration closes 30 March');
  // "closes" marks 30 March as the deadline even though 25 March is sooner
  assert.equal(parsed.deadlineRaw, '30 March');
});

test('otherwise picks the soonest future date', () => {
  const parsed = parse('Dates', 'Round one 20 March, round two 15 March');
  assert.equal(parsed.deadlineRaw, '15 March');
});

test('the date-order setting is applied to numeric dates', () => {
  assert.equal(new Date(parse('Due', 'Last date 04/05/2027').deadline).getMonth(), 4); // 4 May
  assert.equal(new Date(parse('Due', 'Last date 04/05/2027', { dateOrder: 'MDY' }).deadline).getMonth(), 3); // April 5
});

test('no date found gives a null deadline', () => {
  const parsed = parse('Hello', 'No dates here');
  assert.equal(parsed.deadline, null);
  assert.equal(parsed.deadlineRaw, null);
  assert.equal(parsed.dateCandidates.length, 0);
});

test('extracts the sender domain in lower case', () => {
  assert.equal(parse('x', 'y', { email: 'Exams@SRMIST.edu.in' }).senderDomain, 'srmist.edu.in');
});
