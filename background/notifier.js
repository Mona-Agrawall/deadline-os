// background/notifier.js
// Desktop reminders for upcoming deadlines.
// Each reminder is a chrome.alarm named "deadline_{id}_{minutesBefore}";
// when it fires, a chrome.notification is shown.

const Notifier = (() => {

  const REMINDER_MINUTES = [1440, 60, 15]; // 24 hours, 1 hour, 15 minutes before
  const ALARM_PREFIX = 'deadline_';
  const NOTIFICATION_PREFIX = 'deadlineos_';
  const OVERDUE_TAG = 'overdue';
  const ICON_PATH = 'assets/icons/icon128.svg';

  function alarmName(deadlineId, minutes) {
    return `${ALARM_PREFIX}${deadlineId}_${minutes}`;
  }

  // ── Scheduling ─────────────────────────────────────────────────────

  async function scheduleReminders(deadline) {
    if (!deadline.deadline) return;

    const deadlineTime = new Date(deadline.deadline).getTime();
    for (const minutes of REMINDER_MINUTES) {
      const when = deadlineTime - minutes * 60 * 1000;
      if (when > Date.now()) {
        chrome.alarms.create(alarmName(deadline.id, minutes), { when });
      }
    }
  }

  function cancelReminders(deadlineId) {
    for (const minutes of REMINDER_MINUTES) {
      chrome.alarms.clear(alarmName(deadlineId, minutes));
    }
  }

  // Alarms can be lost when the browser restarts, so recreate them on launch
  async function rescheduleAll() {
    const deadlines = await Storage.getAllDeadlines();
    for (const deadline of deadlines) {
      if (!Storage.isResolved(deadline)) await scheduleReminders(deadline);
    }
  }

  // ── Showing notifications ──────────────────────────────────────────

  function formatTimeLeft(minutes) {
    if (minutes >= 1440) return `in ${Math.round(minutes / 60)} hours`;
    if (minutes >= 60) return `in ${Math.round(minutes / 60)} hour${minutes >= 120 ? 's' : ''}`;
    return `in ${minutes} minutes`;
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
    cancelReminders(deadlineId);
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
