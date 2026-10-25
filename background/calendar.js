// background/calendar.js
// Creates Google Calendar events for deadlines.

const Calendar = (() => {

  const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
  const EVENT_DURATION_MS = 30 * 60 * 1000;

  async function apiCall(method, endpoint, body = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);

    const response = await Auth.authorizedFetch(`${CALENDAR_API}${endpoint}`, options);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Calendar API ${response.status}: ${err?.error?.message || 'Unknown error'}`);
    }
    return response.json();
  }

  // The iCalUID is derived from the deadline id, so the same deadline always
  // maps to the same event. That lets us detect events we already created.
  function getICalUID(deadline) {
    return `deadlineos-${deadline.id}@gmail.deadline`;
  }

  async function findExistingEvent(iCalUID, calendarId) {
    try {
      const result = await apiCall(
        'GET',
        `/calendars/${encodeURIComponent(calendarId)}/events?iCalUID=${encodeURIComponent(iCalUID)}&maxResults=1`
      );
      return result?.items?.[0] || null;
    } catch (e) {
      console.warn('[Calendar] Could not check for existing event:', e.message);
      return null; // safer to try creating it
    }
  }

  function buildDescription(deadline) {
    return [
      `📧 From: ${deadline.senderName || 'Unknown'} <${deadline.senderEmail || ''}>`,
      `🏷️ Category: ${deadline.category}`,
      `⚡ Urgency: ${deadline.urgency}`,
      `📊 Confidence: ${Math.round((deadline.score || 0) * 100)}%`,
      '',
      deadline.deadlineRaw ? `📅 Original date text: "${deadline.deadlineRaw}"` : '',
      '',
      `🔗 Gmail: ${deadline.emailUrl}`,
      '',
      '— Created by Deadline OS Chrome Extension',
    ].join('\n');
  }

  // "YYYY-MM-DD" in the user's local time zone
  function toLocalDateString(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function buildEvent(deadline) {
    const emoji = getCategoryEmoji(deadline.category);
    const common = {
      description: buildDescription(deadline),
      iCalUID: getICalUID(deadline),
      source: { title: 'Open in Gmail', url: deadline.emailUrl },
    };

    // No date found: an all-day "review" event for today
    if (!deadline.deadline) {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      return {
        ...common,
        summary: `${emoji} [Review] ${deadline.subject}`,
        start: { date: toLocalDateString(today) },
        end: { date: toLocalDateString(tomorrow) }, // end date is exclusive
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] },
      };
    }

    // A 30-minute event that ends at the deadline, with reminders 24h and 1h before
    const end = new Date(deadline.deadline);
    const start = new Date(end.getTime() - EVENT_DURATION_MS);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return {
      ...common,
      summary: `${emoji} ${deadline.subject}`,
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 24 * 60 },
          { method: 'popup', minutes: 60 },
        ],
      },
    };
  }

  // Returns { created, eventId, htmlLink, iCalUID } — `created` is false when
  // the event already existed (e.g. created before the extension was reinstalled)
  async function createEvent(deadline, calendarId = 'primary') {
    const event = buildEvent(deadline);

    const existing = await findExistingEvent(event.iCalUID, calendarId);
    if (existing) {
      return { created: false, reason: 'already_exists', eventId: existing.id, htmlLink: existing.htmlLink, iCalUID: event.iCalUID };
    }

    const created = await apiCall('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, event);
    return { created: true, eventId: created.id, htmlLink: created.htmlLink, iCalUID: event.iCalUID };
  }

  return { createEvent };
})();
