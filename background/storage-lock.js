// background/storage-lock.js
// chrome.storage has no transactions, so two read-modify-write operations
// running at the same time (e.g. an inbox scan and an opened email) can
// overwrite each other. Every such operation runs through this queue,
// one at a time. Never call withStorageLock() from inside another one.

let storageQueue = Promise.resolve();

function withStorageLock(operation) {
  const result = storageQueue.then(() => operation());
  storageQueue = result.catch(() => {}); // a failure must not block the queue
  return result;
}
