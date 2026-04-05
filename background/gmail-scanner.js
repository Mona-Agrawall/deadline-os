// background/gmail-scanner.js
// Uses Gmail API to fetch and process inbox emails in bulk.
// This is the "automatic scanning" feature — no need to open emails manually.
// Must be importScripts'd AFTER calendar.js (needs getToken).

const GmailScanner = (() => {

  const GMAIL_API = 'https://www.googleapis.com/gmail/v1';
  const MAX_RESULTS = 50;
  const FETCH_DELAY_MS = 200; // Rate limiting between individual message fetches

  // ── Gmail API helpers ──────────────────────────────────────────────

  async function getToken() {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
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

  async function gmailApiCall(endpoint, token) {
    const response = await fetch(`${GMAIL_API}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 401) {
      // Token expired — clear and retry once
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, resolve);
      });
      const newToken = await getToken();
      const retry = await fetch(`${GMAIL_API}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${newToken}` },
      });
      if (!retry.ok) {
        const err = await retry.json().catch(() => ({}));
        throw new Error(`Gmail API ${retry.status}: ${err?.error?.message || 'Unknown'}`);
      }
      return retry.json();
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Gmail API ${response.status}: ${err?.error?.message || 'Unknown'}`);
    }

    return response.json();
  }

  // ── Base64url decode ───────────────────────────────────────────────
  // Gmail API returns body data in base64url encoding (RFC 4648 §5)

  function decodeBase64Url(data) {
    if (!data) return '';
    try {
      // Replace base64url chars with standard base64
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      return decodeURIComponent(
        atob(base64).split('').map(c =>
          '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join('')
      );
    } catch (e) {
      console.warn('[GmailScanner] Base64 decode failed:', e.message);
      return '';
    }
  }

  // ── Extract email body from Gmail API message parts ────────────────
  // Gmail messages have a nested MIME structure — we want plain text first,
  // falling back to HTML stripped of tags.

  function extractBody(payload) {
    if (!payload) return '';

    // Simple message (no parts)
    if (payload.body?.data) {
      return decodeBase64Url(payload.body.data);
    }

    // Multipart — walk the tree looking for text/plain or text/html
    if (payload.parts) {
      // Prefer text/plain
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return decodeBase64Url(part.body.data);
        }
      }
      // Fallback to text/html (strip tags)
      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          const html = decodeBase64Url(part.body.data);
          return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }
      // Recurse into nested multipart (e.g., multipart/alternative inside multipart/mixed)
      for (const part of payload.parts) {
        if (part.parts) {
          const nested = extractBody(part);
          if (nested) return nested;
        }
      }
    }

    return '';
  }

  // ── Convert Gmail API message → our emailData format ───────────────

  function messageToEmailData(message) {
    const headers = message.payload?.headers || [];

    function getHeader(name) {
      const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return h ? h.value : null;
    }

    const subject = getHeader('Subject') || '(no subject)';
    const from = getHeader('From') || '';
    const date = getHeader('Date') || '';
    const messageId = message.id;

    // Parse "From: Name <email@domain.com>" format
    const fromMatch = from.match(/^(.+?)\s*<(.+?)>$/);
    const senderName = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : from;
    const senderEmail = fromMatch ? fromMatch[2].trim() : from;

    // Extract body text (cap at 3000 chars to match DOM extraction)
    const body = extractBody(message.payload).slice(0, 3000);

    // Build Gmail URL for this email
    const emailUrl = `https://mail.google.com/mail/u/0/#inbox/${messageId}`;

    return {
      subject,
      sender: { name: senderName, email: senderEmail },
      body,
      receivedDate: date,
      extractedAt: new Date().toISOString(),
      url: emailUrl,
      source: 'gmail_api', // Distinguishes from DOM-extracted emails
      gmailMessageId: messageId,
    };
  }

  // ── Delay utility ─────────────────────────────────────────────────

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Main scan function ─────────────────────────────────────────────
  // Fetches up to 50 inbox messages, processes each through the
  // existing Parser → Scorer → Storage pipeline.

  async function scanInbox() {
    console.log('[GmailScanner] ═══════════════════════════════════════');
    console.log('[GmailScanner] Starting inbox scan...');

    const scanStart = Date.now();
    let token;

    try {
      token = await getToken();
    } catch (e) {
      console.log('[GmailScanner] Not authenticated:', e.message);
      return {
        success: false,
        error: 'not_authenticated',
        message: 'Please connect your Google account first.',
      };
    }

    let results = {
      success: true,
      scanned: 0,
      newDeadlines: 0,
      duplicates: 0,
      ignored: 0,
      errors: 0,
      scanTime: 0,
    };

    try {
      // Step 1: Get message list
      const listResponse = await gmailApiCall(
        `/users/me/messages?maxResults=${MAX_RESULTS}&labelIds=INBOX`,
        token
      );

      const messageIds = (listResponse.messages || []).map(m => m.id);
      console.log(`[GmailScanner] Found ${messageIds.length} messages in inbox`);

      if (messageIds.length === 0) {
        results.scanTime = Date.now() - scanStart;
        await saveScanStatus(results);
        return results;
      }

      // Step 2: Fetch each message with full details
      for (let i = 0; i < messageIds.length; i++) {
        try {
          // Rate limiting
          if (i > 0) await delay(FETCH_DELAY_MS);

          const message = await gmailApiCall(
            `/users/me/messages/${messageIds[i]}?format=full`,
            token
          );

          const emailData = messageToEmailData(message);
          results.scanned++;

          // Step 3: Check deduplication
          const fp = Deduplicator.fingerprint(emailData);
          const alreadySeen = await Deduplicator.isDuplicate(fp);

          if (alreadySeen) {
            results.duplicates++;
            continue;
          }

          // Step 4: Parse and score
          const parsed = Parser.parse(emailData);
          const scored = Scorer.score(parsed);

          console.log(`[GmailScanner] ${i + 1}/${messageIds.length} | ` +
            `"${emailData.subject.slice(0, 50)}" → ${scored.category} ` +
            `(${scored.score}) → ${scored.action}`);

          if (scored.action === 'ignore') {
            results.ignored++;
            continue;
          }

          // Step 5: Save deadline
          const deadlineObj = {
            id: fp,
            subject: scored.emailSubject,
            senderName: scored.senderName,
            senderEmail: scored.senderEmail,
            category: scored.category,
            deadline: scored.deadline,
            deadlineRaw: scored.deadlineRaw,
            deadlineDaysFromNow: scored.deadlineDaysFromNow,
            urgency: scored.urgency,
            score: scored.score,
            action: scored.action,
            emailUrl: emailData.url,
            savedAt: new Date().toISOString(),
            status: scored.action === 'auto_save' ? 'pending' : 'confirm',
            calendarEventId: null,
            source: 'gmail_api',
          };

          const saveResult = await Storage.saveDeadline(deadlineObj);
          await Deduplicator.markProcessed(fp);

          if (saveResult.saved) {
            results.newDeadlines++;

            // Schedule notifications for this deadline
            if (typeof Notifier !== 'undefined') {
              try {
                await Notifier.scheduleReminders(deadlineObj);
              } catch (e) {
                console.warn('[GmailScanner] Notification scheduling failed:', e.message);
              }
            }

            // Auto-sync to calendar for high-confidence deadlines
            if (scored.action === 'auto_save') {
              try {
                const authed = await Calendar.isAuthenticated();
                if (authed) {
                  await syncDeadlineToCalendar(fp);
                }
              } catch (e) {
                console.warn('[GmailScanner] Calendar sync skipped:', e.message);
              }
            }
          } else {
            results.duplicates++;
          }

        } catch (msgError) {
          console.warn(`[GmailScanner] Error processing message ${messageIds[i]}:`, msgError.message);
          results.errors++;
        }
      }

    } catch (e) {
      console.error('[GmailScanner] Scan failed:', e.message);
      results.success = false;
      results.error = e.message;
    }

    results.scanTime = Date.now() - scanStart;
    await saveScanStatus(results);

    console.log('[GmailScanner] ─────────────────────────────────────────');
    console.log(`[GmailScanner] Scan complete in ${results.scanTime}ms`);
    console.log(`[GmailScanner] Scanned: ${results.scanned} | New: ${results.newDeadlines} | ` +
      `Dupes: ${results.duplicates} | Ignored: ${results.ignored} | Errors: ${results.errors}`);
    console.log('[GmailScanner] ═══════════════════════════════════════');

    return results;
  }

  // ── Persist scan status ────────────────────────────────────────────

  async function saveScanStatus(results) {
    await chrome.storage.local.set({
      lastScanTime: new Date().toISOString(),
      lastScanResults: results,
    });
  }

  async function getScanStatus() {
    const data = await chrome.storage.local.get(['lastScanTime', 'lastScanResults']);
    return {
      lastScanTime: data.lastScanTime || null,
      lastScanResults: data.lastScanResults || null,
    };
  }

  return {
    scanInbox,
    getScanStatus,
  };

})();
