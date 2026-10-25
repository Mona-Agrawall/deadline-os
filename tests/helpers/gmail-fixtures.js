// Builds fake Gmail API responses for scanner and service worker tests.

const ACCOUNT_EMAIL = 'mona@gmail.com';

function base64Url(text) {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

// A Gmail API message. `format`: 'plain' | 'html' | 'nested'
function gmailMessage({ id, from, subject, date = 'Wed, 10 Mar 2027 09:00:00 +0530', body, format = 'plain' }) {
  const headers = [
    { name: 'Subject', value: subject },
    { name: 'From', value: from },
    { name: 'Date', value: date },
  ];

  let payload;
  if (format === 'html') {
    payload = { headers, mimeType: 'text/html', body: { data: base64Url(`<html><style>p{}</style><p>${body}</p></html>`) } };
  } else if (format === 'nested') {
    payload = {
      headers,
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: base64Url(body) } }] },
        { mimeType: 'application/pdf', filename: 'a.pdf', body: { attachmentId: 'x' } },
      ],
    };
  } else {
    payload = { headers, mimeType: 'text/plain', body: { data: base64Url(body) } };
  }

  return { id, threadId: `thread-${id}`, payload };
}

// Routes for createFakeFetch() serving a Gmail inbox made of `messages`,
// plus a Calendar API that accepts every event. Ids in `failingIds` are
// listed in the inbox but fail with a server error when fetched.
function gmailRoutes(messages, { calendarEvents = [], failingIds = [] } = {}) {
  const ids = [...failingIds, ...messages.map(m => m.id)];
  return [
    ['/gmail/v1/users/me/profile', () => ({ body: { emailAddress: ACCOUNT_EMAIL } })],
    ['/gmail/v1/users/me/messages?', () => ({ body: { messages: ids.map(id => ({ id })) } })],
    [(url) => /\/gmail\/v1\/users\/me\/messages\/[^?]+\?format=full/.test(url), (request) => {
      const id = request.url.match(/messages\/([^?]+)\?/)[1];
      if (failingIds.includes(id)) return { status: 500, body: { error: { message: 'Backend Error' } } };
      return { body: messages.find(m => m.id === id) };
    }],
    [(url) => url.includes('/calendar/v3/') && url.includes('iCalUID='), () => ({ body: { items: [] } })],
    [(url, request) => url.includes('/calendar/v3/') && request.method === 'POST', (request) => {
      calendarEvents.push(request.body);
      const n = calendarEvents.length;
      return { body: { id: `event-${n}`, htmlLink: `https://calendar.google.com/event-${n}` } };
    }],
  ];
}

module.exports = { ACCOUNT_EMAIL, gmailMessage, gmailRoutes };
