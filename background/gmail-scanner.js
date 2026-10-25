// background/gmail-scanner.js
// Scans the inbox through the Gmail API so deadlines are found without
// the user opening each email.
//
// Two filters keep the scan fast and quiet:
//   1. A Gmail search query only returns recent, deadline-related mail.
//   2. A quick sender/subject check skips obvious marketing before parsing.

const GmailScanner = (() => {

  const MAX_RESULTS = 30;
  const FETCH_DELAY_MS = 150; // pause between message fetches (rate limiting)
  const LAST_SCAN_TIME_KEY = 'lastScanTime';
  const LAST_SCAN_RESULTS_KEY = 'lastScanResults';

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
    `{${SEARCH_KEYWORDS.map(k => (k.includes(' ') ? `"${k}"` : k)).join(' ')}}`,
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

  // settings: { collegeDomains, careerDomains }
  function shouldSkipEmail(emailData, settings) {
    const senderEmail = (emailData.sender.email || '').toLowerCase();
    const senderDomain = SenderDomains.getDomain(senderEmail);
    const subject = emailData.subject.toLowerCase();

    if (SenderDomains.isTrusted(senderDomain, settings)) return false;
    if (SenderDomains.matches(senderDomain, SenderDomains.BLOCKED)) return true;

    // Automated senders are skipped unless the subject looks important
    if (AUTOMATED_SENDER_REGEX.test(senderEmail) && !IMPORTANT_SUBJECT_REGEX.test(subject)) {
      return true;
    }

    return JUNK_SUBJECT_PATTERNS.some(p => p.test(subject));
  }

  // ── Scan ───────────────────────────────────────────────────────────

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function runScan() {
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
      const settings = await Settings.get();
      const accountEmail = await GmailApi.getAccountEmail().catch(() => null);
      const messageIds = await GmailApi.listMessageIds(SEARCH_QUERY, MAX_RESULTS);

      for (let i = 0; i < messageIds.length; i++) {
        if (i > 0) await delay(FETCH_DELAY_MS);

        try {
          const message = await GmailApi.getMessage(messageIds[i]);
          const emailData = GmailApi.toEmailData(message, accountEmail);
          results.scanned++;

          if (shouldSkipEmail(emailData, settings)) {
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
      [LAST_SCAN_TIME_KEY]: new Date().toISOString(),
      [LAST_SCAN_RESULTS_KEY]: results,
    });

    console.log('[GmailScanner] Scan complete:', results);
    return results;
  }

  // A scan started while another is running (e.g. the popup's Scan button
  // during the 30-minute poll) shares the running scan instead of doubling it.
  let activeScan = null;

  function scanInbox() {
    if (!activeScan) {
      activeScan = runScan().finally(() => { activeScan = null; });
    }
    return activeScan;
  }

  async function getScanStatus() {
    const data = await chrome.storage.local.get([LAST_SCAN_TIME_KEY, LAST_SCAN_RESULTS_KEY]);
    return {
      lastScanTime: data[LAST_SCAN_TIME_KEY] || null,
      lastScanResults: data[LAST_SCAN_RESULTS_KEY] || null,
    };
  }

  return { scanInbox, getScanStatus };
})();
