// content/email-extractor.js
// Responsible for extracting structured data from an open Gmail email.
// Uses a layered selector strategy: try the most stable selectors first,
// fall back gracefully. Never throw — always return what we can.

const EmailExtractor = (() => {

  // These selectors are ordered by stability (most stable first).
  // Gmail's h2 for subject has been consistent for years.
  // If Gmail updates break one, the next is tried.
  const SUBJECT_SELECTORS = [
    'h2.hP',                          // primary — very stable
    '[data-thread-perm-id] h2',       // fallback 1
    '.ha h2',                         // fallback 2
  ];

  const BODY_SELECTORS = [
    '.a3s.aiL',                       // primary — the actual email body div
    '.a3s',                           // fallback 1
    '[data-message-id] .ii.gt div',   // fallback 2
  ];

  const SENDER_SELECTORS = [
    '.gD',                            // sender name span — very stable
    '[email].go',                     // sender with email attr
  ];

  const DATE_SELECTORS = [
    '.g3',                            // date string in email header
    '[data-hovercard-id] + span .g3', // fallback
    'span[title*="202"]',             // any span whose title contains a year
  ];

  function queryFirst(selectors, context = document) {
    for (const sel of selectors) {
      try {
        const el = context.querySelector(sel);
        if (el) return el;
      } catch (e) {
        // Invalid selector — skip silently
      }
    }
    return null;
  }

  function extractSubject() {
    const el = queryFirst(SUBJECT_SELECTORS);
    return el ? el.innerText.trim() : null;
  }

  function extractSender() {
    const el = queryFirst(SENDER_SELECTORS);
    if (!el) return { name: null, email: null };
    return {
      name: el.getAttribute('name') || el.innerText.trim(),
      email: el.getAttribute('email') || null,
    };
  }

  function extractBody() {
    const el = queryFirst(BODY_SELECTORS);
    if (!el) return null;
    // Get text only — strip HTML tags
    return el.innerText.trim().slice(0, 3000); // cap at 3000 chars for now
  }

  function extractDate() {
    const el = queryFirst(DATE_SELECTORS);
    if (!el) return null;
    // Gmail shows dates like "Apr 2, 2026, 10:30 AM" or just "10:30 AM" for today
    return el.getAttribute('title') || el.innerText.trim();
  }

  function extract() {
    const subject = extractSubject();
    const sender = extractSender();
    const body = extractBody();
    const receivedDate = extractDate();

    // Only return if we have at least subject or body
    if (!subject && !body) return null;

    return {
      subject,
      sender,
      body,
      receivedDate,
      extractedAt: new Date().toISOString(),
      url: window.location.href,
    };
  }

  return { extract };
})();