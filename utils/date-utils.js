// utils/date-utils.js
// Normalizes all date formats we might find in emails into
// a standard { date: Date, confidence: number, raw: string } object.
// Never throws — always returns null on failure.

const DateUtils = (() => {

  // Current year for resolving incomplete dates like "April 5"
  const CURRENT_YEAR = new Date().getFullYear();

  const MONTHS = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8, sept: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
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

  // Resolve "next Monday", "this Friday" etc.
  function resolveDayOfWeek(dayName, modifier) {
    const today = new Date();
    const todayDay = today.getDay();
    const targetDay = DAYS_OF_WEEK[dayName.toLowerCase()];
    if (targetDay === undefined) return null;

    let diff = targetDay - todayDay;
    if (modifier === 'next' || diff <= 0) diff += 7;
    const result = new Date(today);
    result.setDate(today.getDate() + diff);
    result.setHours(23, 59, 0, 0); // end of day default
    return result;
  }

  // Resolve "tomorrow", "today", "in 3 days"
  function resolveRelativeDay(text) {
    const today = new Date();
    const lower = text.toLowerCase().trim();

    if (lower === 'today') {
      const d = new Date(today);
      d.setHours(23, 59, 0, 0);
      return d;
    }
    if (lower === 'tomorrow') {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      d.setHours(23, 59, 0, 0);
      return d;
    }

    // "in X days/weeks"
    const inMatch = lower.match(/in\s+(\d+)\s+(day|week)s?/);
    if (inMatch) {
      const n = parseInt(inMatch[1]);
      const unit = inMatch[2];
      const d = new Date(today);
      d.setDate(d.getDate() + (unit === 'week' ? n * 7 : n));
      d.setHours(23, 59, 0, 0);
      return d;
    }

    return null;
  }

  // Parse absolute dates: "April 5", "Apr 5, 2026", "5th April", "04/05/2026"
  function parseAbsoluteDate(text) {
    const lower = text.toLowerCase().trim();

    // MM/DD/YYYY or DD/MM/YYYY
    const slashMatch = lower.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const d = new Date(
        parseInt(slashMatch[3]),
        parseInt(slashMatch[1]) - 1,
        parseInt(slashMatch[2])
      );
      if (!isNaN(d)) return d;
    }

    // YYYY-MM-DD (ISO format in email footers)
    const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const d = new Date(
        parseInt(isoMatch[1]),
        parseInt(isoMatch[2]) - 1,
        parseInt(isoMatch[3])
      );
      if (!isNaN(d)) return d;
    }

    // "April 5" or "April 5, 2026" or "5th April" or "5 April 2026"
    const monthNameMatch = lower.match(
      /(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*,?\s*(\d{4})?/
    ) || lower.match(
      /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})?/
    );

    if (monthNameMatch) {
      // Figure out which group is month vs day
      let month, day, year;
      const firstIsNum = /^\d/.test(monthNameMatch[1]);
      if (firstIsNum) {
        day = parseInt(monthNameMatch[1]);
        month = MONTHS[monthNameMatch[2].slice(0, 3)];
        year = monthNameMatch[3] ? parseInt(monthNameMatch[3]) : CURRENT_YEAR;
      } else {
        month = MONTHS[monthNameMatch[1].slice(0, 3)];
        day = parseInt(monthNameMatch[2]);
        year = monthNameMatch[3] ? parseInt(monthNameMatch[3]) : CURRENT_YEAR;
      }
      if (month !== undefined && day) {
        const d = new Date(year, month, day, 23, 59, 0, 0);
        if (!isNaN(d)) return d;
      }
    }

    return null;
  }

  // Extract time from string: "3:00 PM", "15:00", "11:59 PM"
  function extractTime(text) {
    const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const meridiem = timeMatch[3]?.toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    return { hours, minutes };
  }

  // Master function — tries all strategies
  function parse(text) {
    if (!text) return null;

    // Try relative first
    const relative = resolveRelativeDay(text);
    if (relative) {
      const time = extractTime(text);
      if (time) {
        relative.setHours(time.hours, time.minutes, 0, 0);
      }
      return relative;
    }

    // Try day-of-week
    const dowMatch = text.toLowerCase().match(
      /(next|this)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/i
    );
    if (dowMatch) {
      const resolved = resolveDayOfWeek(dowMatch[2], dowMatch[1]);
      if (resolved) {
        const time = extractTime(text);
        if (time) resolved.setHours(time.hours, time.minutes, 0, 0);
        return resolved;
      }
    }

    // Try absolute date
    const absolute = parseAbsoluteDate(text);
    if (absolute) {
      const time = extractTime(text);
      if (time) absolute.setHours(time.hours, time.minutes, 0, 0);
      return absolute;
    }

    return null;
  }

  function isInFuture(date) {
    return date && date > new Date();
  }

  function daysFromNow(date) {
    const diff = date - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  return { parse, isInFuture, daysFromNow, extractTime };
})();