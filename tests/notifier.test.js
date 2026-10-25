const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadServiceWorker, flush } = require('./helpers/load-extension');

const NOW = new Date(2027, 2, 10, 10, 0);
const HOUR = 60 * 60 * 1000;

function setup() {
  const sw = loadServiceWorker({ now: NOW });
  return { ...sw, Notifier: sw.get('Notifier'), Storage: sw.get('Storage'), Settings: sw.get('Settings') };
}

function deadline(id, hoursFromNow, fields = {}) {
  return {
    id,
    subject: `Subject ${id}`,
    senderName: 'Exam Cell',
    category: 'ASSIGNMENT',
    deadline: new Date(NOW.getTime() + hoursFromNow * HOUR).toISOString(),
    status: 'pending',
    emailUrl: `https://mail.google.com/mail/u/0/#all/${id}`,
    ...fields,
  };
}

test('schedules one alarm per reminder time, skipping times already past', () => {
  const { Notifier, state } = setup();
  Notifier.scheduleReminders(deadline('dl_a', 10), [1440, 60, 15]); // due in 10 hours

  assert.deepEqual(Object.keys(state.alarms).sort(), ['deadline_dl_a_15', 'deadline_dl_a_60']);
  assert.equal(state.alarms.deadline_dl_a_60.when, NOW.getTime() + 9 * HOUR);
});

test('does nothing for deadlines without a date', () => {
  const { Notifier, state } = setup();
  Notifier.scheduleReminders(deadline('dl_a', 10, { deadline: null }), [60]);
  assert.deepEqual(state.alarms, {});
});

test('cancelReminders removes every alarm of that deadline only', async () => {
  const { Notifier, state } = setup();
  Notifier.scheduleReminders(deadline('dl_a', 48), [1440, 60]);
  Notifier.scheduleReminders(deadline('dl_b', 48), [60]);
  state.alarms['deadline_dl_a_2880'] = { when: 1 }; // left over from an old setting

  await Notifier.cancelReminders('dl_a');
  assert.deepEqual(Object.keys(state.alarms), ['deadline_dl_b_60']);
});

test('rescheduleAll rebuilds reminders from current settings for active deadlines', async () => {
  const { Notifier, Storage, Settings, state } = setup();
  await Storage.saveDeadline(deadline('dl_a', 48));
  await Storage.saveDeadline(deadline('dl_done', 48, { status: 'done' }));
  state.alarms['deadline_dl_a_15'] = { when: 1 };
  state.alarms['deadlineos-poll'] = { periodInMinutes: 30 };

  await Settings.save({ reminderMinutes: [180] });
  await Notifier.rescheduleAll();

  assert.deepEqual(Object.keys(state.alarms).sort(), ['deadline_dl_a_180', 'deadlineos-poll']);
});

test('a reminder alarm shows a notification with time left', async () => {
  const { Notifier, Storage, state } = setup();
  await Storage.saveDeadline(deadline('dl_a', 1));
  await Notifier.handleAlarm({ name: 'deadline_dl_a_60' });

  assert.equal(state.notifications.length, 1);
  const shown = state.notifications[0];
  assert.equal(shown.id, 'deadlineos_dl_a_60');
  assert.equal(shown.title, '⏰ Deadline in 1 hour: 📝');
  assert.equal(shown.message, 'Subject dl_a\n— from Exam Cell');
  assert.equal(shown.requireInteraction, true);
  assert.equal(shown.iconUrl, 'chrome-extension://test-id/assets/icons/icon128.png');
});

test('formats the time left for each reminder', async () => {
  const { Notifier, Storage, state } = setup();
  await Storage.saveDeadline(deadline('dl_a', 72));
  for (const minutes of [2880, 1440, 180, 15]) await Notifier.handleAlarm({ name: `deadline_dl_a_${minutes}` });

  assert.deepEqual(state.notifications.map(n => n.title), [
    '⏰ Deadline in 2 days: 📝',
    '⏰ Deadline in 1 day: 📝',
    '⏰ Deadline in 3 hours: 📝',
    '⏰ Deadline in 15 minutes: 📝',
  ]);
});

test('an alarm for a passed deadline shows an overdue notification', async () => {
  const { Notifier, Storage, state } = setup();
  await Storage.saveDeadline(deadline('dl_a', -1));
  await Notifier.handleAlarm({ name: 'deadline_dl_a_15' });
  assert.equal(state.notifications[0].id, 'deadlineos_overdue_dl_a');
  assert.equal(state.notifications[0].title, '🚨 OVERDUE: 📝 ASSIGNMENT');
});

test('no notification for done, dismissed or deleted deadlines, or unrelated alarms', async () => {
  const { Notifier, Storage, state } = setup();
  await Storage.saveDeadline(deadline('dl_done', 1, { status: 'done' }));
  await Notifier.handleAlarm({ name: 'deadline_dl_done_60' });
  await Notifier.handleAlarm({ name: 'deadline_dl_missing_60' });
  await Notifier.handleAlarm({ name: 'something-else' });
  assert.equal(state.notifications.length, 0);
});

test('clicking a notification opens the email; "Mark Done" resolves it', async () => {
  const { Notifier, Storage, state } = setup();
  await Storage.saveDeadline(deadline('dl_a', 30));
  Notifier.scheduleReminders(await Storage.getDeadline('dl_a'), [1440, 60]);

  Notifier.handleNotificationClick('deadlineos_dl_a_60');
  Notifier.handleNotificationClick('deadlineos_overdue_dl_a', 0);
  await flush();
  assert.deepEqual(state.openedTabs, ['https://mail.google.com/mail/u/0/#all/dl_a', 'https://mail.google.com/mail/u/0/#all/dl_a']);

  Notifier.handleNotificationClick('deadlineos_dl_a_1440', 1);
  await flush(10);
  assert.equal((await Storage.getDeadline('dl_a')).status, 'done');
  assert.deepEqual(state.alarms, {});
  assert.deepEqual(state.clearedNotifications, ['deadlineos_dl_a_60', 'deadlineos_overdue_dl_a', 'deadlineos_dl_a_1440']);
});
