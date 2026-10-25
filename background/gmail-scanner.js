// background/gmail-scanner.js
// Scans the inbox through the Gmail API so deadlines are found without
// the user opening each email.
//
// Two filters keep the scan fast and quiet:
//   1. A Gmail search query only returns recent, deadline-related mail.
//   2. A quick sender/subject check skips obvious marketing before parsing.

const GmailScanner = (() => {

  const GMAIL_API = 'https://www.googleapis.com/gmail/v1';
  const MAX_RESULTS = 30;
  const FETCH_DELAY_MS = 150;   // pause between message fetches (rate limiting)
  const MAX_BODY_LENGTH = 3000; // same cap as the content script

  // ── Gmail search query ─────────────────────────────────────────────

  const SEARCH_KEYWORDS = [
    // Interview & hiring
    'interview', 'interview scheduled', 'interview confirmation',
    'phone screen', 'hiring assessment', 'hirevue', 'codility',
    'hackerrank', 'technical round', 'hr round', 'recruiter',
    'shortlisted', 'selected', 'candidacy',
    // Placement & career
    'placement', 'placement drive', 'campus recruitment',
    'off-campus drive', 'pre-placement offer', 'ppo',
    'haveloc', 'internship offer', 'job offer',
    // Deadlines & assignments
    'deadline', 'due date', 'submission deadline', 'submit by',
    'last date', 'assignment due', 'exam schedule',
    'registration deadline', 'apply by', 'apply before',
    // Academic
    'viva', 'cia exam', 'end sem', 'mid sem', 'lab evaluation',
    // Payment / fee
    'fee payment', 'payment due', 'tuition due', 'hostel fee',
    // Action required
    'action required', 'response needed', 'urgent reminder',
  ];

  const EXCLUDED_SENDERS = [
    'noreply@linkedin.com', 'notifications@linkedin.com',
    'noreply@medium.com', 'noreply@quora.com',
    'no-reply@accounts.google.com', 'noreply@youtube.com',
    'newsletter@', 'marketing@', 'digest@', 'updates@',
    'noreply@github.com', 'notifications@github.com',
  ];

  // Inbox mail from the last 7 days, outside the Promotions/Social/Forums
  // tabs, matching any keyword ({a b c} means "a OR b OR c" in Gmail search)
  const SEARCH_QUERY = [
    'in:inbox',
    'newer_than:7d',
    '-category:promotions -category:social -category:forums',
    EXCLUDED_SENDERS.map(s => `-from:${s}`).join(' '),
    `{${SEARCH_KEYWORDS.join(' ')}}`,
  ].join(' ');

  // ── Quick pre-filter ───────────────────────────────────────────────

  const AUTOMATED_SENDER_REGEX =
    /^(noreply|no-reply|notifications?|newsletter|marketing|updates|digest|info|mailer|donotreply)@/i;
  const IMPORTANT_SUBJECT_REGEX =
    /interview|placement|deadline|submission|exam|assessment|shortlisted|selected|haveloc/i;

  const JUNK_SUBJECT_PATTERNS = [
    // Newsletter / marketing
    /newsletter/i, /digest/i, /weekly roundup/i, /monthly update/i,
    /what's new/i, /product update/i, /just launched/i,
    /check out/i, /trending/i, /top picks/i, /curated/i,
    /exclusive offer/i, /\bsale\b/i, /discount/i, /free trial/i,
    /upgrade your/i, /premium/i, /introducing/i, /announcing/i,
    /is now/i, /is here/i, /powered by/i, /how to/i,
    /don't miss out/i, /best of/i, /guide to/i, /tips for/i,
    // Social / engagement bait
    /\d+ people viewed/i, /new connection/i, /endorsed you/i,
    /your weekly/i, /your daily/i, /your \w+ summary/i,
    /someone mentioned/i, /new follower/i,
    // Transactional noise
    /order confirmation/i, /order shipped/i, /delivery update/i,
    /your receipt/i, /purchase confirmation/i,
    /password reset/i, /verify your email/i, /login alert/i,
  ];

  function shouldSkipEmail(emailData) {
    const senderEmail = (emailData.sender.email || '').toLowerCase();
    const senderDomain = senderEmail.split('@')[1] || '';
    const subject = emailData.subject.toLowerCase();

    if (SenderDomains.isTrusted(senderDomain)) return false;
    if (SenderDomains.matches(senderDomain, SenderDomains.BLOCKED)) return true;

    // Automated senders are skipped unless the subject looks important
    if (AUTOMATED_SENDER_REGEX.test(senderEmail) && !IMPORTANT_SUBJECT_REGEX.test(subject)) {
      return true;
    }

    return JUNK_SUBJECT_PATTERNS.some(p => p.test(subject));
  }

  // ── Gmail API ──────────────────────────────────────────────────────

  async function gmailApiCall(endpoint) {
    const response = await Auth.authorizedFetch(`${GMAIL_API}${endpoint}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Gmail API ${response.status}: ${err?.error?.message || 'Unknown'}`);
    }
    return response.json();
  }

  // Gmail returns message bodies as base64url-encoded UTF-8
  function decodeBase64Url(data) {
    try {
      const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch (e) {
      console.warn('[GmailScanner] Could not decode body:', e.message);
      return '';
    }
  }

  function stripHtml(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Walks the MIME tree: plain text first, then HTML, then nested parts
  function extractBody(payload) {
    if (payload.body?.data) return decodeBase64Url(payload.body.data);
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

  // Converts a Gmail API message into the same shape the content script sends
  function toEmailData(message) {
    const headers = message.payload?.headers || [];
    const getHeader = (name) =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    // "Name <email@domain.com>" or just "email@domain.com"
    const from = getHeader('From');
    const fromMatch = from.match(/^(.+?)\s*<(.+?)>$/);

    return {
      subject: getHeader('Subject') || '(no subject)',
      sender: {
        name: fromMatch ? fromMatch[1].replace(/"/g, '').trim() : from,
        email: fromMatch ? fromMatch[2].trim() : from,
      },
      body: message.payload ? extractBody(message.payload).slice(0, MAX_BODY_LENGTH) : '',
      receivedDate: getHeader('Date'),
      url: `https://mail.google.com/mail/u/0/#inbox/${message.id}`,
    };
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Scan ───────────────────────────────────────────────────────────

  async function scanInbox() {
    if (!(await Auth.isAuthenticated())) {
      return {
        success: false,
        error: 'not_authenticated',
        message: 'Please connect your Google account first.',
      };
    }

    const scanStart = Date.now();
    const results = {
      success: true,
      scanned: 0,
      newDeadlines: 0,
      duplicates: 0,
      ignored: 0,
      errors: 0,
      scanTime: 0,
    };

    try {
      const list = await gmailApiCall(
        `/users/me/messages?maxResults=${MAX_RESULTS}&q=${encodeURIComponent(SEARCH_QUERY)}`
      );
      const messageIds = (list.messages || []).map(m => m.id);

      for (let i = 0; i < messageIds.length; i++) {
        if (i > 0) await delay(FETCH_DELAY_MS);

        try {
          const message = await gmailApiCall(`/users/me/messages/${messageIds[i]}?format=full`);
          const emailData = toEmailData(message);
          results.scanned++;

          if (shouldSkipEmail(emailData)) {
            results.ignored++;
            continue;
          }

          const { status } = await EmailPipeline.processEmail(emailData, 'gmail_api');
          if (status === 'saved') results.newDeadlines++;
          if (status === 'duplicate') results.duplicates++;
          if (status === 'ignored') results.ignored++;
        } catch (e) {
          console.warn(`[GmailScanner] Failed to process message ${messageIds[i]}:`, e.message);
          results.errors++;
        }
      }
    } catch (e) {
      console.error('[GmailScanner] Scan failed:', e.message);
      results.success = false;
      results.error = e.message;
    }

    results.scanTime = Date.now() - scanStart;
    await chrome.storage.local.set({
      lastScanTime: new Date().toISOString(),
      lastScanResults: results,
    });

    console.log('[GmailScanner] Scan complete:', results);
    return results;
  }

  async function getScanStatus() {
    const data = await chrome.storage.local.get(['lastScanTime', 'lastScanResults']);
    return {
      lastScanTime: data.lastScanTime || null,
      lastScanResults: data.lastScanResults || null,
    };
  }

  return { scanInbox, getScanStatus };
})();
