// Loads the extension's own source files into isolated contexts for testing:
//   loadScripts()        — chosen background/utils files in a VM sandbox
//   loadServiceWorker()  — the whole service worker, with a message helper
//   loadPage()           — an HTML page (popup, options, Gmail) in jsdom
// Files run exactly as the browser would run them: as classic scripts that
// share one global scope.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { createFakeChrome } = require('./fake-chrome');

const ROOT = path.join(__dirname, '..', '..');

function readSource(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

const silentConsole = { log() {}, warn() {}, error() {}, info() {} };

// A Date class whose "now" is fixed, so date-dependent results are stable
function createFixedDate(now) {
  const fixedTime = new Date(now).getTime();
  return class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(fixedTime);
      else super(...args);
    }

    static now() {
      return fixedTime;
    }
  };
}

// Fake fetch: `routes` is a list of [matcher, handler]. The matcher is a
// string the URL must contain or a predicate (url, options) → boolean; the
// handler returns { status?, body } or throws. Every request is recorded.
function createFakeFetch(routes = []) {
  const requests = [];
  async function fetch(url, options = {}) {
    const request = {
      url: decodeURIComponent(url),
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    requests.push(request);

    const route = routes.find(([matcher]) =>
      typeof matcher === 'string' ? request.url.includes(matcher) : matcher(request.url, request));
    if (!route) throw new Error(`Unexpected request: ${request.method} ${request.url}`);

    const { status = 200, body = {} } = await route[1](request);
    return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
  }
  return { fetch, requests };
}

function loadScripts(files, { now, fetch } = {}) {
  const { chrome, state } = createFakeChrome();
  const context = {
    chrome,
    fetch: fetch || (async (url) => { throw new Error(`Unexpected request: ${url}`); }),
    console: silentConsole,
    Date: now ? createFixedDate(now) : Date,
    setTimeout,
    clearTimeout,
    atob,
    TextDecoder,
    Intl,
    structuredClone,
  };
  vm.createContext(context);
  context.importScripts = (...paths) => {
    for (const file of paths) vm.runInContext(readSource(file), context, { filename: file });
  };
  context.importScripts(...files);

  // Top-level `const` declarations aren't properties of `context`, so modules
  // like DateParser are read by evaluating their name inside the sandbox
  const get = name => vm.runInContext(name, context);
  return { context, get, chrome, state };
}

// Loads background/service-worker.js (which imports every module) and
// returns helpers to send messages and fire alarms like Chrome would.
function loadServiceWorker(options = {}) {
  const loaded = loadScripts(['background/service-worker.js'], options);
  const { state } = loaded;

  // Like chrome.runtime.sendMessage: the response arrives JSON-serialised
  function sendMessage(message) {
    return new Promise((resolve) => {
      const respond = response => resolve(response === undefined ? undefined : plain(response));
      let isAsync = false;
      for (const listener of state.listeners.message) {
        if (listener(message, {}, respond) === true) isAsync = true;
      }
      if (!isAsync) resolve(undefined);
    });
  }

  async function fireAlarm(name) {
    for (const listener of state.listeners.alarm) await listener({ name });
  }

  return { ...loaded, sendMessage, fireAlarm };
}

// Loads an HTML page from the project into jsdom with a fake chrome whose
// runtime.sendMessage is answered by `handleMessage(message)`.
// `scripts` are run in the page's global scope, in order.
function loadPage({ html, url, scripts, handleMessage = () => null }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const window = dom.window;
  const { chrome, state } = createFakeChrome();
  const sentMessages = [];

  // Messages cross a process boundary in Chrome, so they arrive serialised
  chrome.runtime.sendMessage = (message, callback) => {
    const sent = plain(message);
    sentMessages.push(sent);
    Promise.resolve()
      .then(() => handleMessage(sent))
      .then((response) => callback && callback(response === undefined ? null : structuredClone(response)));
  };

  // jsdom doesn't implement innerText; textContent is close enough for tests
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
  });

  window.chrome = chrome;
  window.console = silentConsole;
  window.alert = message => state.alerts.push(message);
  window.confirm = () => true;
  state.alerts = [];

  const vmContext = dom.getInternalVMContext();
  for (const file of scripts) vm.runInContext(readSource(file), vmContext, { filename: file });

  return { window, document: window.document, chrome, state, sentMessages, close: () => window.close() };
}

// Waits for queued promises and short timers to finish
function flush(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Converts objects created inside a sandbox into plain objects, so
// assert.deepStrictEqual can compare them with objects made in the test
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { ROOT, readSource, loadScripts, loadServiceWorker, loadPage, createFakeFetch, flush, plain };
