// A small in-memory stand-in for the chrome.* APIs the extension uses.
// `state` exposes what the code did (stored data, alarms, notifications...)
// so tests can assert on it.

function createFakeChrome() {
  const state = {
    storage: {},
    alarms: {},
    notifications: [],
    clearedNotifications: [],
    openedTabs: [],
    authenticated: true,
    removedTokens: 0,
    optionsOpened: 0,
    listeners: {
      installed: [], startup: [], message: [], alarm: [], notificationClick: [], notificationButton: [],
    },
  };

  const copy = value => (value === undefined ? undefined : structuredClone(value));
  const event = name => ({ addListener: fn => state.listeners[name].push(fn) });

  const chrome = {
    runtime: {
      lastError: undefined,
      onInstalled: event('installed'),
      onStartup: event('startup'),
      onMessage: event('message'),
      getURL: path => `chrome-extension://test-id/${path}`,
      openOptionsPage: () => { state.optionsOpened++; },
    },

    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) return copy(state.storage);
          const result = {};
          for (const key of [].concat(keys)) {
            if (key in state.storage) result[key] = copy(state.storage[key]);
          }
          return result;
        },
        async set(items) { Object.assign(state.storage, copy(items)); },
        async remove(key) { delete state.storage[key]; },
        async clear() { state.storage = {}; },
      },
    },

    identity: {
      getAuthToken(options, callback) {
        if (state.authenticated) {
          callback('test-token');
          return;
        }
        chrome.runtime.lastError = { message: 'The user is not signed in.' };
        callback(undefined);
        chrome.runtime.lastError = undefined;
      },
      removeCachedAuthToken(details, callback) {
        state.removedTokens++;
        callback();
      },
    },

    alarms: {
      create(name, info) { state.alarms[name] = { ...info }; },
      async clear(name) {
        const existed = name in state.alarms;
        delete state.alarms[name];
        return existed;
      },
      async getAll() {
        return Object.entries(state.alarms).map(([name, info]) => ({ name, scheduledTime: info.when }));
      },
      onAlarm: event('alarm'),
    },

    notifications: {
      create(id, options) { state.notifications.push({ id, ...options }); },
      clear(id) { state.clearedNotifications.push(id); },
      onClicked: event('notificationClick'),
      onButtonClicked: event('notificationButton'),
    },

    tabs: {
      create({ url }) { state.openedTabs.push(url); },
    },
  };

  return { chrome, state };
}

module.exports = { createFakeChrome };
