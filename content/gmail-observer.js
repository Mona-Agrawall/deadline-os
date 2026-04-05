// content/gmail-observer.js
// Watches for Gmail SPA navigation and email open events.
// Strategy: observe URL changes + DOM mutations on the main content area.
// Debounced to avoid firing multiple times on rapid DOM updates.

(() => {
  let lastUrl = window.location.href;
  let debounceTimer = null;
  let lastProcessedUrl = null;
  let observer = null;

  // --- Debounce utility ---
  function debounce(fn, delay) {
    return function (...args) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // --- Check if current URL looks like an open email ---
  function isEmailOpen() {
    // Gmail email URLs contain '#inbox/' or '#all/' followed by a thread ID
    return /mail\.google\.com\/mail\/(u\/\d+\/)?#/.test(window.location.href) &&
           !window.location.hash.endsWith('#inbox') &&
           !window.location.hash.endsWith('#sent') &&
           document.querySelector('h2.hP') !== null; // subject heading present
  }

  // --- Called when we believe an email is open and ready ---
  const handleEmailOpen = debounce(() => {
    if (!isEmailOpen()) return;
    const currentUrl = window.location.href;
    if (currentUrl === lastProcessedUrl) return;
    lastProcessedUrl = currentUrl;


    // Give Gmail a moment to finish rendering the body
    
  setTimeout(() => {
  const emailData = EmailExtractor.extract();
  if (!emailData) {
    console.warn('[DeadlineOS] Email open detected but extraction failed.');
    return;
  }

  console.log('[DeadlineOS] Email extracted:', emailData);

  // Wake the service worker first, then send email data.
  // MV3 service workers go idle — this ping ensures globals are ready.
  function sendEmailToSW(retries = 3) {
    chrome.runtime.sendMessage({ type: 'PING' }, () => {
      if (chrome.runtime.lastError) {
        // SW not ready yet — retry after a short delay
        if (retries > 0) {
          setTimeout(() => sendEmailToSW(retries - 1), 300);
        }
        return;
      }

      // SW is awake — now send the real data
      chrome.runtime.sendMessage({
        type: 'EMAIL_OPENED',
        payload: emailData,
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[DeadlineOS] Message error:', chrome.runtime.lastError.message);
          return;
        }
        console.log('[DeadlineOS] SW response:', response?.status, response);
      });
    });
  }

  sendEmailToSW();
}, 800); // 800ms lets Gmail finish lazy-loading the email body

  }, 400); // 400ms debounce on the observer itself

  // --- URL polling for SPA navigation ---
  // MutationObserver alone misses URL changes in Gmail's SPA routing
  function startUrlPoller() {
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        handleEmailOpen();
      }
    }, 500);
  }

  // --- MutationObserver on Gmail's main content area ---
  function startDOMObserver() {
    // Gmail renders email content inside this container
    // We wait for it to exist before observing
    const targetSelector = '.AO'; // Gmail's main view container — stable for years

    function attachObserver() {
      const target = document.querySelector(targetSelector);
      if (!target) {
        // Not ready yet — retry
        setTimeout(attachObserver, 500);
        return;
      }

      observer = new MutationObserver(handleEmailOpen);
      observer.observe(target, {
        childList: true,
        subtree: true,
      });

      console.log('[DeadlineOS] Observer attached to Gmail content area.');
    }

    attachObserver();
  }

  // --- Init ---
  function init() {
    console.log('[DeadlineOS] Content script loaded on Gmail.');
    startUrlPoller();
    startDOMObserver();
    // Also try on initial load in case an email is already open
    setTimeout(handleEmailOpen, 1500);
  }

  init();
})();