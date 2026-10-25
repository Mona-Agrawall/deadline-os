// background/date-parser.js
// Finds dates written in email text and turns them into Date objects:
//   "tomorrow", "in 3 days", "next Friday", "15th March 2027",
//   "March 15", "12/03/2027", "2027-03-12" — plus a nearby time like "5 PM".
// Dates without a time default to 11:59 PM (end of that day).

const DateParser = (() => {

  const DAY_MS = 24 * 60 * 60 * 1000;
  const HALF_YEAR_MS = 182 * DAY_MS;
  const TIME_SEARCH_CHARS = 30;  // how far around a date to look for its time
  const MIN_YEAR = 2000;
  const MAX_YEAR = 2100;

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

  const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const WEEKDAY_PREFIX = '(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+)?'; // "Fri, " / "Friday "
  const YEAR_SUFFIX = '(?:,?\\s*(\\d{4}))?';

  // Each pattern turns a regex match into { year?, month, day } or { offsetDays } or { weekday }
  const PATTERNS = [
    { // 2027-03-12
      regex: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/gi,
      read: m => ({ year: +m[1], month: m[2] - 1, day: +m[3] }),
    },
    { // 12/03/2027, 12-03-27, 12.03.2027 — order depends on settings
      regex: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/gi,
      read: (m, options) => readNumericDate(+m[1], +m[2], +m[3], options.dateOrder),
    },
    { // 15 March, 15th of March 2027, Fri 15 Mar
      regex: new RegExp(`\\b${WEEKDAY_PREFIX}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b\\.?${YEAR_SUFFIX}`, 'gi'),
      read: m => ({ year: m[3] && +m[3], month: MONTHS[m[2].slice(0, 3).toLowerCase()], day: +m[1] }),
    },
    { // March 15, Mar 15th, 2027, Friday March 15
      regex: new RegExp(`\\b${WEEKDAY_PREFIX}${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b${YEAR_SUFFIX}`, 'gi'),
      read: m => ({ year: m[3] && +m[3], month: MONTHS[m[1].slice(0, 3).toLowerCase()], day: +m[2] }),
    },
    {
      regex: /\bday after tomorrow\b/gi,
      read: () => ({ offsetDays: 2 }),
    },
    {
      regex: /\b(today|tonight|tomorrow)\b/gi,
      read: m => ({ offsetDays: m[1].toLowerCase() === 'tomorrow' ? 1 : 0 }),
    },
    { // in 3 days, in two weeks
      regex: /\bin\s+(\d{1,2}|an?|one|two|three|four|five|six|seven)\s+(day|week)s?\b/gi,
      read: (m) => {
        const n = NUMBER_WORDS[m[1].toLowerCase()] || +m[1];
        return { offsetDays: m[2].toLowerCase() === 'week' ? n * 7 : n };
      },
    },
    { // Friday, this Friday, next Friday
      regex: /\b(?:(next|this|coming)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
      read: m => ({ weekday: WEEKDAYS[m[2].toLowerCase()], next: (m[1] || '').toLowerCase() === 'next' }),
    },
  ];

  // 5 PM, 5:30 pm, 11:59 P.M., 17:00, noon, midnight
  const TIME_REGEX = /\b(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?(?![a-z])|\b([01]?\d|2[0-3]):([0-5]\d)\b|\b(noon|midnight)\b/gi;

  // ── Building dates ─────────────────────────────────────────────────

  // Returns a Date at 23:59, or null if the day doesn't exist (e.g. 31 Feb)
  function buildDate(year, month, day) {
    if (year < MIN_YEAR || year > MAX_YEAR) return null;
    const date = new Date(year, month, day, 23, 59, 0, 0);
    return date.getMonth() === month && date.getDate() === day ? date : null;
  }

  // A number > 12 can only be the day; otherwise the user's preferred order decides
  function readNumericDate(first, second, year, dateOrder) {
    const fullYear = year < 100 ? 2000 + year : year;
    const dayFirst = first > 12 || (second <= 12 && dateOrder !== 'MDY');
    return dayFirst
      ? { year: fullYear, month: second - 1, day: first }
      : { year: fullYear, month: first - 1, day: second };
  }

  // Turns a pattern's result into a Date, relative to `now` where needed
  function resolve(parts, now) {
    if (parts.offsetDays !== undefined) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + parts.offsetDays, 23, 59);
    }

    if (parts.weekday !== undefined) {
      let diff = parts.weekday - now.getDay();
      if (parts.next || diff <= 0) diff += 7;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, 23, 59);
    }

    if (parts.year) return buildDate(parts.year, parts.month, parts.day);

    // No year written: use this year, unless that's long past ("Jan 5" read in December)
    const thisYear = buildDate(now.getFullYear(), parts.month, parts.day);
    if (thisYear && now - thisYear > HALF_YEAR_MS) {
      return buildDate(now.getFullYear() + 1, parts.month, parts.day);
    }
    return thisYear;
  }

  // ── Times ──────────────────────────────────────────────────────────

  function readTime(match) {
    const [text, hour12, minutes12, meridiem, hour24, minutes24, word] = match;
    if (word) {
      return word.toLowerCase() === 'noon'
        ? { text, hours: 12, minutes: 0 }
        : { text, hours: 23, minutes: 59 }; // "by midnight" = end of that day
    }
    if (hour24 !== undefined) return { text, hours: +hour24, minutes: +minutes24 };

    let hours = +hour12;
    if (hours < 1 || hours > 12) return null;
    if (meridiem.toLowerCase() === 'p' && hours < 12) hours += 12;
    if (meridiem.toLowerCase() === 'a' && hours === 12) hours = 0;
    return { text, hours, minutes: +(minutes12 || 0) };
  }

  function findTimes(text) {
    TIME_REGEX.lastIndex = 0;
    return [...text.matchAll(TIME_REGEX)].map(readTime).filter(Boolean);
  }

  // Looks for a time on the same line just after the date, then just before it
  function findNearbyTime(text, start, end) {
    const after = text.slice(end, end + TIME_SEARCH_CHARS).split('\n')[0];
    const before = text.slice(Math.max(0, start - TIME_SEARCH_CHARS), start).split('\n').pop();
    return findTimes(after)[0] || findTimes(before).pop() || null;
  }

  // ── Main ───────────────────────────────────────────────────────────

  // Returns every date found in `text`, in reading order:
  // [{ raw, date, index }]
  function findDates(text, { dateOrder = 'DMY', now = new Date() } = {}) {
    if (!text) return [];

    const matches = [];
    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      for (const m of text.matchAll(pattern.regex)) {
        const date = resolve(pattern.read(m, { dateOrder }), now);
        if (date) matches.push({ start: m.index, end: m.index + m[0].length, date });
      }
    }

    // Where patterns overlap ("Friday, 15 March" vs "Friday"), keep the longer match
    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept = [];
    for (const match of matches) {
      if (kept.length === 0 || match.start >= kept[kept.length - 1].end) kept.push(match);
    }

    return kept.map(({ start, end, date }) => {
      const dateText = text.slice(start, end).trim().replace(/[.,]$/, '');
      const time = findNearbyTime(text, start, end);
      if (!time) return { raw: dateText, date, index: start };

      date.setHours(time.hours, time.minutes, 0, 0);
      return { raw: `${dateText} ${time.text}`, date, index: start };
    });
  }

  return { findDates };
})();
