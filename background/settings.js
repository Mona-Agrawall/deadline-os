// background/settings.js
// User preferences, edited on the options page and stored in chrome.storage.

const Settings = (() => {

  const SETTINGS_KEY = 'settings';
  const MAX_REMINDER_MINUTES = 7 * 24 * 60;
  const DOMAIN_REGEX = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

  const DEFAULTS = {
    dateOrder: 'DMY',                 // how "03/04/2027" is read: 'DMY' = 3 April, 'MDY' = March 4
    reminderMinutes: [1440, 60, 15],  // 1 day, 1 hour, 15 minutes before
    collegeDomains: SenderDomains.DEFAULT_COLLEGE,
    careerDomains: SenderDomains.DEFAULT_CAREER,
  };

  // "  @Mail.SRMIST.edu.in " or "https://srmist.edu.in/" → "mail.srmist.edu.in" / "srmist.edu.in"
  function cleanDomains(domains) {
    const cleaned = (Array.isArray(domains) ? domains : [])
      .map(d => String(d).trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^.*@/, '')
        .replace(/\/.*$/, ''))
      .filter(d => DOMAIN_REGEX.test(d));
    return [...new Set(cleaned)];
  }

  function cleanReminders(minutes) {
    const cleaned = (Array.isArray(minutes) ? minutes : [])
      .map(Number)
      .filter(m => Number.isInteger(m) && m > 0 && m <= MAX_REMINDER_MINUTES);
    return [...new Set(cleaned)].sort((a, b) => b - a);
  }

  // Fills gaps with defaults and drops anything invalid
  function sanitize(input) {
    return {
      dateOrder: input.dateOrder === 'MDY' ? 'MDY' : 'DMY',
      reminderMinutes: cleanReminders(input.reminderMinutes ?? DEFAULTS.reminderMinutes),
      collegeDomains: cleanDomains(input.collegeDomains ?? DEFAULTS.collegeDomains),
      careerDomains: cleanDomains(input.careerDomains ?? DEFAULTS.careerDomains),
    };
  }

  async function get() {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return sanitize(result[SETTINGS_KEY] || {});
  }

  function save(changes) {
    return withStorageLock(async () => {
      const result = await chrome.storage.local.get(SETTINGS_KEY);
      const settings = sanitize({ ...result[SETTINGS_KEY], ...changes });
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      return settings;
    });
  }

  async function reset() {
    await chrome.storage.local.remove(SETTINGS_KEY);
    return sanitize({});
  }

  return { DEFAULTS, get, save, reset };
})();
