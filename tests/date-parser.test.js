const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers/load-extension');

// "Now" for every test: Wednesday 10 March 2027, 10:00 local time
const NOW = new Date(2027, 2, 10, 10, 0);
const DateParser = loadScripts(['background/date-parser.js']).get('DateParser');

// Returns found dates as readable "YYYY-MM-DD HH:MM" strings (local time)
function find(text, options = {}) {
  return Array.from(DateParser.findDates(text, { now: NOW, ...options }), ({ raw, date }) => {
    const pad = n => String(n).padStart(2, '0');
    const when = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return { raw, when };
  });
}

const whens = (text, options) => find(text, options).map(d => d.when);

describe('absolute dates', () => {
  test('day-month and month-day with year', () => {
    assert.deepEqual(whens('Due 15th March 2027'), ['2027-03-15 23:59']);
    assert.deepEqual(whens('Due March 15, 2027'), ['2027-03-15 23:59']);
    assert.deepEqual(whens('on the 5th of April 2027'), ['2027-04-05 23:59']);
    assert.deepEqual(whens('Sept 3 2027'), ['2027-09-03 23:59']);
  });

  test('a weekday in front of the date is part of the same date', () => {
    assert.deepEqual(find('Interview on Friday, 12 March 2027'), [{ raw: 'Friday, 12 March 2027', when: '2027-03-12 23:59' }]);
  });

  test('ISO dates', () => {
    assert.deepEqual(whens('Deadline: 2027-04-01'), ['2027-04-01 23:59']);
  });

  test('impossible dates are ignored', () => {
    assert.deepEqual(whens('31 February 2027 or 2027-13-01'), []);
  });

  test('a month name alone, or "may" as a verb, is not a date', () => {
    assert.deepEqual(whens('Results in March. You may submit later.'), []);
  });
});

describe('numeric dates follow the date-order setting', () => {
  test('day-first by default (12/03/2027 = 12 March)', () => {
    assert.deepEqual(whens('Last date 12/03/2027'), ['2027-03-12 23:59']);
    assert.deepEqual(whens('Last date 12-03-27'), ['2027-03-12 23:59']);
    assert.deepEqual(whens('Last date 12.03.2027'), ['2027-03-12 23:59']);
  });

  test('month-first when the user chooses MDY', () => {
    assert.deepEqual(whens('Last date 12/03/2027', { dateOrder: 'MDY' }), ['2027-12-03 23:59']);
  });

  test('an unambiguous date is read correctly whatever the setting', () => {
    assert.deepEqual(whens('Due 25/03/2027', { dateOrder: 'MDY' }), ['2027-03-25 23:59']);
    assert.deepEqual(whens('Due 03/25/2027', { dateOrder: 'DMY' }), ['2027-03-25 23:59']);
  });

  test('version numbers and IP addresses are not dates', () => {
    assert.deepEqual(whens('Update to v1.2.3 on server 192.168.1.10'), []);
  });
});

describe('dates without a year', () => {
  test('use the current year', () => {
    assert.deepEqual(whens('Submit by 20 March'), ['2027-03-20 23:59']);
  });

  test('a recent past date stays in the past', () => {
    assert.deepEqual(whens('The deadline was March 5'), ['2027-03-05 23:59']);
  });

  test('a date long past rolls over to next year ("Jan 5" read in December)', () => {
    const december = new Date(2027, 11, 20, 10, 0);
    assert.deepEqual(whens('Fees due Jan 5', { now: december }), ['2028-01-05 23:59']);
  });
});

describe('relative dates', () => {
  test('today, tonight, tomorrow, day after tomorrow', () => {
    assert.deepEqual(whens('due today'), ['2027-03-10 23:59']);
    assert.deepEqual(whens('closes tonight'), ['2027-03-10 23:59']);
    assert.deepEqual(whens('due tomorrow'), ['2027-03-11 23:59']);
    assert.deepEqual(whens('due day after tomorrow'), ['2027-03-12 23:59']);
  });

  test('in N days / weeks, with digits or words', () => {
    assert.deepEqual(whens('expires in 3 days'), ['2027-03-13 23:59']);
    assert.deepEqual(whens('expires in two weeks'), ['2027-03-24 23:59']);
    assert.deepEqual(whens('expires in a day'), ['2027-03-11 23:59']);
  });

  test('weekdays always point forward; "next" skips a week', () => {
    assert.deepEqual(whens('by Friday'), ['2027-03-12 23:59']);
    assert.deepEqual(whens('by this Friday'), ['2027-03-12 23:59']);
    assert.deepEqual(whens('by next Friday'), ['2027-03-19 23:59']);
    assert.deepEqual(whens('by Wednesday'), ['2027-03-17 23:59']); // today is Wednesday
  });

  test('words that merely contain a weekday name are not dates', () => {
    assert.deepEqual(whens('Course lasts 10 months; we sat the exam; Sunflower club'), []);
  });
});

describe('times', () => {
  test('a time right after the date is attached to it', () => {
    assert.deepEqual(find('Interview on March 15, 2027 at 3:00 PM'), [{ raw: 'March 15, 2027 3:00 PM', when: '2027-03-15 15:00' }]);
    assert.deepEqual(whens('due 25th March 2027 11:59 PM'), ['2027-03-25 23:59']);
    assert.deepEqual(whens('starts tomorrow 17:30'), ['2027-03-11 17:30']);
  });

  test('a time shortly after, in the next sentence of the same line, is attached', () => {
    assert.deepEqual(whens('Payment due tomorrow. Pay before 5:00 pm.'), ['2027-03-11 17:00']);
  });

  test('a time just before the date is attached', () => {
    assert.deepEqual(whens('Submit by 9 a.m. on Friday'), ['2027-03-12 09:00']);
  });

  test('noon and midnight', () => {
    assert.deepEqual(whens('tomorrow noon'), ['2027-03-11 12:00']);
    assert.deepEqual(whens('tomorrow by midnight'), ['2027-03-11 23:59']);
  });

  test('12 AM / 12 PM edge cases', () => {
    assert.deepEqual(whens('tomorrow 12 am'), ['2027-03-11 00:00']);
    assert.deepEqual(whens('tomorrow 12 pm'), ['2027-03-11 12:00']);
  });

  test('a time on another line is not attached', () => {
    assert.deepEqual(whens('Due tomorrow\nOffice hours 5 PM'), ['2027-03-11 23:59']);
  });

  test('words starting with "am"/"pm" are not times', () => {
    assert.deepEqual(whens('tomorrow 3 amazing talks'), ['2027-03-11 23:59']);
  });
});

test('several dates are returned in reading order', () => {
  assert.deepEqual(whens('Register by 12 March. Event on 20 March 2027.'), ['2027-03-12 23:59', '2027-03-20 23:59']);
});

test('empty text returns no dates', () => {
  assert.deepEqual(whens(''), []);
  assert.deepEqual(whens(null), []);
});
