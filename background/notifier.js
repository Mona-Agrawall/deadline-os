// background/notifier.js
// Desktop reminders for upcoming deadlines.
// Each reminder is a chrome.alarm named "deadline_{id}_{minutesBefore}";
// when it fires, a chrome.notification is shown.

const Notifier = (() => {

  const ALARM_PREFIX = 'deadline_';
  const NOTIFICATION_PREFIX = 'deadlineos_';
  const OVERDUE_TAG = 'overdue';
  const ICON_PATH = 'assets/icons/icon128.png';

  function alarmName(deadlineId, minutes) {
    return `${ALARM_PREFIX}${deadlineId}_${minutes}`;
  }

  // ── Scheduling ─────────────────────────────────────────────────────

  // reminderMinutes: e.g. [1440, 60, 15] from the user's settings
  function scheduleReminders(deadline, reminderMinutes) {
    if (!deadline.deadline) return;

    const deadlineTime = new Date(deadline.deadline).getTime();
    for (const minutes of reminderMinutes) {
      const when = deadlineTime - minutes * 60 * 1000;
      if (when > Date.now()) {
        chrome.alarms.create(alarmName(deadline.id, minutes), { when });
      }
    }
  }

  async function clearAlarms(namePrefix) {
    const alarms = await chrome.alarms.getAll();
    await Promise.all(alarms
      .filter(alarm => alarm.name.startsWith(namePrefix))
      .map(alarm => chrome.alarms.clear(alarm.name)));
  }

  function cancelReminders(deadlineId) {
    return clearAlarms(`${ALARM_PREFIX}${deadlineId}_`);
  }

  // Rebuilds every reminder from scratch. Runs on browser launch (alarms can
  // be lost on restart) and when the user changes their reminder times.
  async function rescheduleAll() {
    await clearAlarms(ALARM_PREFIX);
    const [deadlines, settings] = await Promise.all([Storage.getAllDeadlines(), Settings.get()]);
    for (const deadline of deadlines) {
      if (!Storage.isResolved(deadline)) scheduleReminders(deadline, settings.reminderMinutes);
    }
  }

  // ── Showing notifications ──────────────────────────────────────────

  // 2880 → "in 2 days", 180 → "in 3 hours", 15 → "in 15 minutes"
  function formatTimeLeft(minutes) {
    const plural = (n, unit) => `in ${n} ${unit}${n === 1 ? '' : 's'}`;
    if (minutes >= 1440) return plural(Math.round(minutes / 1440), 'day');
    if (minutes >= 60) return plural(Math.round(minutes / 60), 'hour');
    return plural(minutes, 'minute');
  }

  function showNotification(notificationId, title, deadline, requireInteraction) {
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL(ICON_PATH),
      title,
      message: `${deadline.subject}\n— from ${deadline.senderName || 'Unknown sender'}`,
      priority: 2,
      requireInteraction,
      buttons: [
        { title: '📧 Open Email' },
        { title: '✓ Mark Done' },
      ],
    });
  }

  // Called for every alarm the service worker doesn't handle itself
  async function handleAlarm(alarm) {
    if (!alarm.name.startsWith(ALARM_PREFIX)) return;

    // The deadline id itself contains "_", so the minutes are the last part
    const parts = alarm.name.slice(ALARM_PREFIX.length).split('_');
    const minutesBefore = parseInt(parts.pop(), 10);
    const deadline = await Storage.getDeadline(parts.join('_'));
    if (!deadline || Storage.isResolved(deadline) || isNaN(minutesBefore)) return;

    const emoji = getCategoryEmoji(deadline.category);
    const isOverdue = deadline.deadline && new Date(deadline.deadline).getTime() < Date.now();

    if (isOverdue) {
      showNotification(
        `${NOTIFICATION_PREFIX}${OVERDUE_TAG}_${deadline.id}`,
        `🚨 OVERDUE: ${emoji} ${deadline.category}`,
        deadline,
        true
      );
    } else {
      showNotification(
        `${NOTIFICATION_PREFIX}${deadline.id}_${minutesBefore}`,
        `⏰ Deadline ${formatTimeLeft(minutesBefore)}: ${emoji}`,
        deadline,
        minutesBefore <= 60 // keep the 1h and 15min reminders on screen
      );
    }
  }

  // ── Notification clicks ────────────────────────────────────────────

  // "deadlineos_{id}_{minutes}" or "deadlineos_overdue_{id}" → id
  function getDeadlineId(notificationId) {
    const parts = notificationId.slice(NOTIFICATION_PREFIX.length).split('_');
    return parts[0] === OVERDUE_TAG ? parts.slice(1).join('_') : parts.slice(0, -1).join('_');
  }

  async function openEmail(deadlineId) {
    const deadline = await Storage.getDeadline(deadlineId);
    if (deadline?.emailUrl) chrome.tabs.create({ url: deadline.emailUrl });
  }

  async function markDone(deadlineId) {
    await Storage.updateDeadlineStatus(deadlineId, 'done');
    await cancelReminders(deadlineId);
  }

  // Clicking the notification body does the same as the "Open Email" button (index 0)
  function handleNotificationClick(notificationId, buttonIndex = 0) {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;

    const deadlineId = getDeadlineId(notificationId);
    if (buttonIndex === 0) openEmail(deadlineId);
    if (buttonIndex === 1) markDone(deadlineId);

    chrome.notifications.clear(notificationId);
  }

  return {
    scheduleReminders,
    cancelReminders,
    rescheduleAll,
    handleAlarm,
    handleNotificationClick,
  };
})();
