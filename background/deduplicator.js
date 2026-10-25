// background/deduplicator.js
// Gives every email a stable fingerprint so the same deadline is never
// stored twice, no matter how many times the email is opened or scanned.
//
// Fingerprint = hash(subject + sender email + received date).
// These fields never change for a given email, unlike its URL or body.

const Deduplicator = (() => {

  const PROCESSED_IDS_KEY = 'processed_ids';
  const MAX_PROCESSED_IDS = 1000;

  // djb2 string hash — fast and good enough for a personal inbox
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function normalize(str) {
    return (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  function fingerprint(emailData) {
    const subject = normalize(emailData.subject);
    const senderEmail = normalize(emailData.sender?.email);
    const receivedDate = normalize(emailData.receivedDate);
    return 'dl_' + hashString(`${subject}||${senderEmail}||${receivedDate}`);
  }

  async function getProcessedIds() {
    const result = await chrome.storage.local.get(PROCESSED_IDS_KEY);
    return result[PROCESSED_IDS_KEY] || [];
  }

  async function isDuplicate(id) {
    const processedIds = await getProcessedIds();
    return processedIds.includes(id);
  }

  // Remembers the id; the oldest ids are dropped once the cap is reached
  function markProcessed(id) {
    return withStorageLock(async () => {
      const processedIds = await getProcessedIds();
      if (processedIds.includes(id)) return;

      processedIds.push(id);
      await chrome.storage.local.set({
        [PROCESSED_IDS_KEY]: processedIds.slice(-MAX_PROCESSED_IDS),
      });
    });
  }

  return { fingerprint, isDuplicate, markProcessed };
})();
