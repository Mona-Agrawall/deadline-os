// content/email-extractor.js
// Reads the currently open Gmail email from the page.
// Each field has a list of selectors, most stable first, so a Gmail UI
// change to one selector falls back to the next.

const EmailExtractor = (() => {

  const MAX_BODY_LENGTH = 3000;

  const SUBJECT_SELECTORS = [
    'h2.hP',
    '[data-thread-perm-id] h2',
    '.ha h2',
  ];

  const BODY_SELECTORS = [
    '.a3s.aiL',
    '.a3s',
    '[data-message-id] .ii.gt div',
  ];

  const SENDER_SELECTORS = [
    '.gD',            // sender name span (has name + email attributes)
    '[email].go',
  ];

  const DATE_SELECTORS = [
    '.g3',
    '[data-hovercard-id] + span .g3',
    'span[title*="202"]', // any span whose title contains a year
  ];

  function queryFirst(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function extractSubject() {
    return queryFirst(SUBJECT_SELECTORS)?.innerText.trim() || null;
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
    return queryFirst(BODY_SELECTORS)?.innerText.trim().slice(0, MAX_BODY_LENGTH) || null;
  }

  // The title holds the full date ("Apr 2, 2026, 10:30 AM"); the text may be just "10:30 AM"
  function extractReceivedDate() {
    const el = queryFirst(DATE_SELECTORS);
    if (!el) return null;
    return el.getAttribute('title') || el.innerText.trim();
  }

  // Returns null when neither a subject nor a body could be found
  function extract() {
    const subject = extractSubject();
    const body = extractBody();
    if (!subject && !body) return null;

    return {
      subject,
      sender: extractSender(),
      body,
      receivedDate: extractReceivedDate(),
      url: window.location.href,
    };
  }

  return { extract };
})();
