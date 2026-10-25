// content/gmail-observer.js
// Gmail is a single-page app, so there is no page load when an email is
// opened. This script watches URL and DOM changes, and when an email is
// open, sends its contents to the service worker.

(() => {
  const DEBOUNCE_MS = 400;      // let a burst of DOM changes settle
  const RENDER_DELAY_MS = 800;  // let Gmail finish lazy-loading the body
  const POLL_MS = 500;
  const SEND_RETRIES = 3;
  const RETRY_DELAY_MS = 300;

  let lastUrl = window.location.href;
  let lastProcessedUrl = null;
  let debounceTimer = null;

  // An email is open when the URL points inside a mailbox and the subject heading exists
  function isEmailOpen() {
    return /mail\.google\.com\/mail\/(u\/\d+\/)?#/.test(window.location.href) &&
           !window.location.hash.endsWith('#inbox') &&
           !window.location.hash.endsWith('#sent') &&
           document.querySelector('h2.hP') !== null;
  }

  function sendToServiceWorker(emailData, retriesLeft = SEND_RETRIES) {
    chrome.runtime.sendMessage({ type: 'EMAIL_OPENED', payload: emailData }, (response) => {
      if (chrome.runtime.lastError) {
        // The service worker may still be starting up — try again shortly
        if (retriesLeft > 0) {
          setTimeout(() => sendToServiceWorker(emailData, retriesLeft - 1), RETRY_DELAY_MS);
        }
        return;
      }
      console.log('[DeadlineOS] Email processed:', response?.status);
    });
  }

  function processOpenEmail() {
    if (!isEmailOpen()) return;

    const currentUrl = window.location.href;
    if (currentUrl === lastProcessedUrl) return;
    lastProcessedUrl = currentUrl;

    setTimeout(() => {
      const emailData = EmailExtractor.extract();
      if (emailData) sendToServiceWorker(emailData);
    }, RENDER_DELAY_MS);
  }

  function scheduleCheck() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processOpenEmail, DEBOUNCE_MS);
  }

  // A MutationObserver alone misses some of Gmail's URL-only navigations
  function watchUrl() {
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        scheduleCheck();
      }
    }, POLL_MS);
  }

  function watchDom() {
    const container = document.querySelector('.AO'); // Gmail's main view container
    if (!container) {
      setTimeout(watchDom, POLL_MS);
      return;
    }
    new MutationObserver(scheduleCheck).observe(container, { childList: true, subtree: true });
  }

  watchUrl();
  watchDom();
  setTimeout(scheduleCheck, 1500); // an email may already be open on page load
})();
