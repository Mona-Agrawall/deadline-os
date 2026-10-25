// background/gmail-api.js
// Thin wrapper around the Gmail REST API, plus conversion of an API
// message into the same `emailData` shape the content script produces.

const GmailApi = (() => {

  const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
  const MAX_BODY_LENGTH = 3000; // same cap as content/email-extractor.js

  async function apiCall(endpoint) {
    const response = await Auth.authorizedFetch(`${GMAIL_API}${endpoint}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Gmail API ${response.status}: ${err?.error?.message || 'Unknown error'}`);
    }
    return response.json();
  }

  // Email address of the signed-in account, used to build links to its inbox
  async function getAccountEmail() {
    const profile = await apiCall('/profile');
    return profile.emailAddress;
  }

  async function listMessageIds(query, maxResults) {
    const result = await apiCall(`/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`);
    return (result.messages || []).map(m => m.id);
  }

  function getMessage(id) {
    return apiCall(`/messages/${id}?format=full`);
  }

  // ── Message → emailData ────────────────────────────────────────────

  // Message bodies are base64url-encoded UTF-8
  function decodeBase64Url(data) {
    try {
      const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
      return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
    } catch {
      return '';
    }
  }

  function stripHtml(html) {
    return html
      .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Walks the MIME tree: plain text first, then HTML, then nested parts
  function extractBody(payload) {
    if (payload.body?.data) {
      const text = decodeBase64Url(payload.body.data);
      return payload.mimeType === 'text/html' ? stripHtml(text) : text;
    }
    if (!payload.parts) return '';

    const plain = payload.parts.find(p => p.mimeType === 'text/plain' && p.body?.data);
    if (plain) return decodeBase64Url(plain.body.data);

    const html = payload.parts.find(p => p.mimeType === 'text/html' && p.body?.data);
    if (html) return stripHtml(decodeBase64Url(html.body.data));

    for (const part of payload.parts) {
      const nested = part.parts ? extractBody(part) : '';
      if (nested) return nested;
    }
    return '';
  }

  // "Name <email@domain.com>" or just "email@domain.com"
  function parseFrom(from) {
    const match = from.match(/^(.*?)\s*<(.+?)>$/);
    if (!match) return { name: from, email: from };
    return { name: match[1].replace(/"/g, '').trim() || match[2], email: match[2].trim() };
  }

  function toEmailData(message, accountEmail) {
    const headers = message.payload?.headers || [];
    const getHeader = (name) =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const account = accountEmail || '0'; // "/u/0" = the first signed-in account
    return {
      subject: getHeader('Subject') || '(no subject)',
      sender: parseFrom(getHeader('From')),
      body: message.payload ? extractBody(message.payload).slice(0, MAX_BODY_LENGTH) : '',
      receivedDate: getHeader('Date'),
      url: `https://mail.google.com/mail/u/${account}/#all/${message.threadId || message.id}`,
    };
  }

  return { getAccountEmail, listMessageIds, getMessage, toEmailData };
})();
