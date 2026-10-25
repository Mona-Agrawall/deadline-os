// utils/date-utils.js
// Turns date text found in emails ("tomorrow", "next Friday 3:00 PM",
// "April 5, 2026", "05/04/2026") into a Date. Returns null if it can't.

const DateUtils = (() => {

  // Used for dates written without a year, like "April 5"
  const CURRENT_YEAR = new Date().getFullYear();

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const DAYS_OF_WEEK = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
  };

  const MONTH_PATTERN =
    'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|' +
    'aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  const DAY_MONTH_REGEX = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\s*,?\\s*(\\d{4})?`);
  const MONTH_DAY_REGEX = new RegExp(`(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})?`);
  const DAY_OF_WEEK_REGEX =
    /(next|this)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/i;

  // Deadlines without an explicit time default to 11:59 PM
  function endOfDay(date) {
    date.setHours(23, 59, 0, 0);
    return date;
  }

  // "today", "tomorrow", "in 3 days", "in 2 weeks"
  function parseRelativeDay(text) {
    const lower = text.toLowerCase().trim();
    const date = new Date();

    if (lower === 'today') return endOfDay(date);

    if (lower === 'tomorrow') {
      date.setDate(date.getDate() + 1);
      return endOfDay(date);
    }

    const inMatch = lower.match(/in\s+(\d+)\s+(day|week)s?/);
    if (inMatch) {
      const n = parseInt(inMatch[1], 10);
      date.setDate(date.getDate() + (inMatch[2] === 'week' ? n * 7 : n));
      return endOfDay(date);
    }

    return null;
  }

  // "Monday", "this Friday", "next Tuesday" — always resolves to a future day
  function parseDayOfWeek(text) {
    const match = text.toLowerCase().match(DAY_OF_WEEK_REGEX);
    if (!match) return null;

    const [, modifier, dayName] = match;
    const date = new Date();
    let diff = DAYS_OF_WEEK[dayName] - date.getDay();
    if (modifier === 'next' || diff <= 0) diff += 7;

    date.setDate(date.getDate() + diff);
    return endOfDay(date);
  }

  // "04/05/2026" (read as MM/DD/YYYY), "2026-04-05", "April 5", "5th April 2026"
  function parseAbsoluteDate(text) {
    const lower = text.toLowerCase().trim();

    const slashMatch = lower.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch.map(Number);
      return new Date(year, month - 1, day);
    }

    const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch.map(Number);
      return new Date(year, month - 1, day);
    }

    const dayMonth = lower.match(DAY_MONTH_REGEX);
    const monthDay = !dayMonth && lower.match(MONTH_DAY_REGEX);
    if (dayMonth || monthDay) {
      const [dayText, monthText, yearText] = dayMonth
        ? [dayMonth[1], dayMonth[2], dayMonth[3]]
        : [monthDay[2], monthDay[1], monthDay[3]];

      const day = parseInt(dayText, 10);
      if (!day) return null;

      const month = MONTHS[monthText.slice(0, 3)];
      const year = yearText ? parseInt(yearText, 10) : CURRENT_YEAR;
      return endOfDay(new Date(year, month, day));
    }

    return null;
  }

  // "3:00 PM", "15:00", "11:59 pm" → { hours, minutes }
  function extractTime(text) {
    const match = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const meridiem = match[3]?.toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    return { hours, minutes };
  }

  function parse(text) {
    if (!text) return null;

    const date = parseRelativeDay(text) || parseDayOfWeek(text) || parseAbsoluteDate(text);
    if (!date) return null;

    const time = extractTime(text);
    if (time) date.setHours(time.hours, time.minutes, 0, 0);
    return date;
  }

  function isInFuture(date) {
    return date > new Date();
  }

  function daysFromNow(date) {
    return Math.ceil((date - new Date()) / (1000 * 60 * 60 * 24));
  }

  return { parse, isInFuture, daysFromNow };
})();
