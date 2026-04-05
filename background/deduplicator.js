// background/deduplicator.js
// Generates a stable fingerprint for each email so we never
// store the same deadline twice — even if the email is opened
// 10 times across multiple sessions.
//
// Strategy: hash(normalized_subject + sender_email + received_date)
// This is stable across opens because these three fields never change
// for the same email.

const Deduplicator = (() => {

  // Simple but effective non-crypto hash (djb2 variant).
  // We don't need crypto security — just collision resistance
  // for a personal email collection.
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Return as positive hex string
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  // Normalize text so minor whitespace/case differences
  // don't create false duplicates
  function normalize(str) {
    return (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  // Generate a stable fingerprint for an email
  // Uses subject + sender email + received date
  // NOT the email URL (that changes) or body (too variable)
  function fingerprint(emailData) {
    const subject = normalize(emailData.subject || '');
    const senderEmail = normalize(emailData.sender?.email || '');
    const receivedDate = normalize(emailData.receivedDate || '');

    const raw = `${subject}||${senderEmail}||${receivedDate}`;
    return 'dl_' + hashString(raw);
  }

  // Check if a fingerprint exists in our processed set
  async function isDuplicate(fp) {
    const result = await chrome.storage.local.get('processed_ids');
    const processedIds = result.processed_ids || [];
    return processedIds.includes(fp);
  }

  // Mark a fingerprint as processed
  async function markProcessed(fp) {
    const result = await chrome.storage.local.get('processed_ids');
    const processedIds = result.processed_ids || [];

    if (!processedIds.includes(fp)) {
      processedIds.push(fp);

      // Cap at 1000 entries to prevent unbounded growth.
      // Old entries fall off the front (FIFO).
      if (processedIds.length > 1000) {
        processedIds.splice(0, processedIds.length - 1000);
      }

      await chrome.storage.local.set({ processed_ids: processedIds });
    }
  }

  return { fingerprint, isDuplicate, markProcessed };
})();