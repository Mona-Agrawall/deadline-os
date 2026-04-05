// background/calendar.js
// Handles all Google Calendar API interactions.
// Uses chrome.identity for OAuth2 — no manual token management needed.
// Designed to be called only for high-confidence deadlines (score > 0.72).

const Calendar = (() => {

  const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

  // ── Token management ───────────────────────────────────────────────

  // Get a valid OAuth token. chrome.identity handles refresh automatically.
  async function getToken(interactive = false) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!token) {
          reject(new Error('No token returned'));
          return;
        }
        resolve(token);
      });
    });
  }

  // Force a fresh token (use after 401 errors)
  async function refreshToken() {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (token) {
          // Remove cached token, then get a fresh one
          chrome.identity.removeCachedAuthToken({ token }, () => {
            chrome.identity.getAuthToken({ interactive: false }, (newToken) => {
              if (chrome.runtime.lastError || !newToken) {
                reject(new Error('Token refresh failed'));
                return;
              }
              resolve(newToken);
            });
          });
        } else {
          reject(new Error('No token to refresh'));
        }
      });
    });
  }

  // ── API call wrapper ───────────────────────────────────────────────

  async function apiCall(method, endpoint, body = null, retry = true) {
    let token;
    try {
      token = await getToken(false);
    } catch (e) {
      throw new Error('Not authenticated. User needs to log in.');
    }

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${CALENDAR_API}${endpoint}`, options);

    // Token expired — refresh and retry once
    if (response.status === 401 && retry) {
      console.log('[Calendar] Token expired, refreshing...');
      await refreshToken();
      return apiCall(method, endpoint, body, false);
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Calendar API ${response.status}: ${err?.error?.message || 'Unknown error'}`);
    }

    // 204 No Content (e.g. delete) has no body
    if (response.status === 204) return null;
    return response.json();
  }

  // ── Duplicate detection ────────────────────────────────────────────
  // Uses iCalUID to check if we already created an event for this deadline.
  // iCalUID is a stable ID we set ourselves — same deadline = same UID.

  async function eventExistsInCalendar(iCalUID, calendarId = 'primary') {
    try {
      const result = await apiCall(
        'GET',
        `/calendars/${encodeURIComponent(calendarId)}/events?iCalUID=${encodeURIComponent(iCalUID)}&maxResults=1`
      );
      return result?.items?.length > 0;
    } catch (e) {
      console.warn('[Calendar] Could not check for existing event:', e.message);
      return false; // Assume not exists — safer to try creating
    }
  }

  // ── Build calendar event object ────────────────────────────────────

  function buildEventObject(deadline) {
    // Generate stable iCalUID from our deadline fingerprint
    const iCalUID = `deadlineos-${deadline.id}@gmail.deadline`;

    // Determine event timing
    let startDateTime, endDateTime;

    if (deadline.deadline) {
      const deadlineDate = new Date(deadline.deadline);

      // If the deadline has a specific time, use it as the event end
      // Make it a 30-minute event ending at the deadline
      endDateTime = deadlineDate.toISOString();
      const startDate = new Date(deadlineDate.getTime() - 30 * 60 * 1000);
      startDateTime = startDate.toISOString();
    } else {
      // No specific date — create an all-day event for today
      // as a "review this deadline" reminder
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      return buildAllDayEvent(deadline, iCalUID, dateStr);
    }

    // Category → emoji prefix for quick visual scanning in calendar
    const categoryEmoji = {
      INTERVIEW: '🎯',
      ASSIGNMENT: '📝',
      PAYMENT: '💳',
      APPLICATION: '📋',
      EVENT: '📅',
      REMINDER: '🔔',
      UNKNOWN: '⏰',
    };
    const emoji = categoryEmoji[deadline.category] || '⏰';

    return {
      summary: `${emoji} ${deadline.subject}`,
      description: buildDescription(deadline),
      start: { dateTime: startDateTime, timeZone: 'Asia/Kolkata' },
      end: { dateTime: endDateTime, timeZone: 'Asia/Kolkata' },
      iCalUID,
      // 2 reminders: 24 hours before and 1 hour before
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 24 * 60 },
          { method: 'popup', minutes: 60 },
        ],
      },
      // Link back to the original email
      source: {
        title: 'Open in Gmail',
        url: deadline.emailUrl,
      },
    };
  }

  function buildAllDayEvent(deadline, iCalUID, dateStr) {
    const categoryEmoji = {
      INTERVIEW: '🎯', ASSIGNMENT: '📝', PAYMENT: '💳',
      APPLICATION: '📋', EVENT: '📅', REMINDER: '🔔', UNKNOWN: '⏰',
    };
    const emoji = categoryEmoji[deadline.category] || '⏰';

    return {
      summary: `${emoji} [Review] ${deadline.subject}`,
      description: buildDescription(deadline),
      start: { date: dateStr },
      end: { date: dateStr },
      iCalUID,
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 60 }],
      },
      source: {
        title: 'Open in Gmail',
        url: deadline.emailUrl,
      },
    };
  }

  function buildDescription(deadline) {
    const lines = [
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
    ];
    return lines.filter(l => l !== undefined).join('\n');
  }

  // ── Main: create event ─────────────────────────────────────────────

  async function createEvent(deadline, calendarId = 'primary') {
    console.log('[Calendar] Creating event for:', deadline.subject);

    const eventObj = buildEventObject(deadline);
    const iCalUID = eventObj.iCalUID;

    // Check for duplicate before creating
    const exists = await eventExistsInCalendar(iCalUID, calendarId);
    if (exists) {
      console.log('[Calendar] Event already exists, skipping:', iCalUID);
      return { created: false, reason: 'already_exists', iCalUID };
    }

    const created = await apiCall(
      'POST',
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      eventObj
    );

    console.log('[Calendar] Event created:', created.id, created.htmlLink);
    return {
      created: true,
      eventId: created.id,
      iCalUID,
      htmlLink: created.htmlLink,
    };
  }

  // ── Auth: trigger login ────────────────────────────────────────────

  async function authenticate() {
    try {
      const token = await getToken(true); // interactive = show login popup
      console.log('[Calendar] Authenticated successfully');
      return { success: true, token };
    } catch (e) {
      console.error('[Calendar] Auth failed:', e.message);
      return { success: false, error: e.message };
    }
  }

  async function isAuthenticated() {
    try {
      await getToken(false); // non-interactive
      return true;
    } catch {
      return false;
    }
  }

  return {
    authenticate,
    isAuthenticated,
    createEvent,
  };
})();