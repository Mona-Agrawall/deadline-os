// background/notifier.js
// Handles Chrome notifications for upcoming deadlines.
// Uses chrome.alarms to schedule reminders and chrome.notifications to display them.
// Alarm naming convention: "deadline_{id}_{minutesBefore}"
// Must be importScripts'd AFTER storage.js.

const Notifier = (() => {

  // Minutes before deadline to send reminders
  const REMINDER_INTERVALS = [1440, 60, 15]; // 24 hours, 1 hour, 15 minutes

  // Category emoji map for notification titles
  const CATEGORY_EMOJI = {
    INTERVIEW: '🎯',
    ASSIGNMENT: '📝',
    PAYMENT: '💳',
    APPLICATION: '📋',
    EVENT: '📅',
    REMINDER: '🔔',
    UNKNOWN: '⏰',
  };

  // ── Schedule reminders for a deadline ──────────────────────────────
  // Creates 3 alarms: 24hr, 1hr, 15min before the deadline.
  // Skips alarms that would fire in the past.

  async function scheduleReminders(deadline) {
    if (!deadline || !deadline.deadline || !deadline.id) {
      console.log('[Notifier] Skipping — no deadline date or ID');
      return;
    }

    const deadlineTime = new Date(deadline.deadline).getTime();
    const now = Date.now();

    // Don't schedule reminders for past deadlines
    if (deadlineTime < now) {
      console.log('[Notifier] Deadline already passed, skipping reminders:', deadline.subject);
      return;
    }

    let scheduled = 0;

    for (const minutes of REMINDER_INTERVALS) {
      const alarmTime = deadlineTime - (minutes * 60 * 1000);
      const alarmName = `deadline_${deadline.id}_${minutes}`;

      // Only schedule if the alarm time is in the future
      if (alarmTime > now) {
        chrome.alarms.create(alarmName, { when: alarmTime });
        scheduled++;
        console.log(`[Notifier] Alarm set: ${alarmName} → ${new Date(alarmTime).toLocaleString()}`);
      }
    }

    console.log(`[Notifier] ${scheduled} reminders scheduled for: ${deadline.subject}`);
  }

  // ── Show a Chrome notification ─────────────────────────────────────

  function showNotification(deadline, minutesBefore) {
    const emoji = CATEGORY_EMOJI[deadline.category] || '⏰';

    let timeText;
    if (minutesBefore >= 1440) {
      timeText = `in ${Math.round(minutesBefore / 60)} hours`;
    } else if (minutesBefore >= 60) {
      timeText = `in ${Math.round(minutesBefore / 60)} hour${minutesBefore >= 120 ? 's' : ''}`;
    } else {
      timeText = `in ${minutesBefore} minutes`;
    }

    const notificationId = `deadlineos_${deadline.id}_${minutesBefore}`;

    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.svg'),
      title: `⏰ Deadline ${timeText}: ${emoji}`,
      message: `${deadline.subject}\n— from ${deadline.senderName || 'Unknown sender'}`,
      priority: 2,
      requireInteraction: minutesBefore <= 60, // Keep on screen for 1hr and 15min reminders
      buttons: [
        { title: '📧 Open Email' },
        { title: '✓ Mark Done' },
      ],
    }, (id) => {
      if (chrome.runtime.lastError) {
        console.warn('[Notifier] Notification error:', chrome.runtime.lastError.message);
      } else {
        console.log('[Notifier] Notification shown:', id);
      }
    });
  }

  // ── Handle alarm fires ─────────────────────────────────────────────
  // Called from the service worker's chrome.alarms.onAlarm listener.
  // Returns true if this alarm was a deadline reminder (vs other alarms).

  async function handleAlarm(alarm) {
    if (!alarm.name.startsWith('deadline_')) return false;

    // Parse alarm name: "deadline_{id}_{minutesBefore}"
    const parts = alarm.name.split('_');
    // ID might contain underscores, so we take the last part as minutes
    const minutesBefore = parseInt(parts[parts.length - 1]);
    // Rejoin everything between first and last part as the ID
    const deadlineId = parts.slice(1, -1).join('_');

    if (!deadlineId || isNaN(minutesBefore)) {
      console.warn('[Notifier] Could not parse alarm name:', alarm.name);
      return true; // Still claim it as ours
    }

    try {
      const deadlines = await Storage.getAllDeadlines();
      const deadline = deadlines.find(d => d.id === deadlineId);

      if (!deadline) {
        console.log('[Notifier] Deadline not found for alarm:', deadlineId);
        return true;
      }

      // Don't notify for done/dismissed deadlines
      if (deadline.status === 'done' || deadline.status === 'dismissed') {
        console.log('[Notifier] Deadline already resolved, skipping notification:', deadline.subject);
        return true;
      }

      // Check if deadline has already passed
      if (deadline.deadline) {
        const deadlineTime = new Date(deadline.deadline).getTime();
        if (deadlineTime < Date.now()) {
          console.log('[Notifier] Deadline already passed:', deadline.subject);
          // Still show notification with "overdue" message
          showOverdueNotification(deadline);
          return true;
        }
      }

      showNotification(deadline, minutesBefore);

    } catch (e) {
      console.error('[Notifier] Error handling alarm:', e.message);
    }

    return true;
  }

  // ── Show overdue notification ──────────────────────────────────────

  function showOverdueNotification(deadline) {
    const emoji = CATEGORY_EMOJI[deadline.category] || '⏰';

    chrome.notifications.create(`deadlineos_overdue_${deadline.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.svg'),
      title: `🚨 OVERDUE: ${emoji} ${deadline.category}`,
      message: `${deadline.subject}\n— from ${deadline.senderName || 'Unknown sender'}`,
      priority: 2,
      requireInteraction: true,
      buttons: [
        { title: '📧 Open Email' },
        { title: '✓ Mark Done' },
      ],
    });
  }

  // ── Handle notification button clicks ──────────────────────────────

  function handleNotificationClick(notificationId) {
    // Extract deadline ID from notification ID: "deadlineos_{id}_{minutes}" or "deadlineos_overdue_{id}"
    if (!notificationId.startsWith('deadlineos_')) return;

    const parts = notificationId.replace('deadlineos_', '').split('_');
    let deadlineId;

    if (parts[0] === 'overdue') {
      deadlineId = parts.slice(1).join('_');
    } else {
      // Remove the last part (minutesBefore) to get the ID
      deadlineId = parts.slice(0, -1).join('_');
    }

    // Open the email
    Storage.getAllDeadlines().then(deadlines => {
      const deadline = deadlines.find(d => d.id === deadlineId);
      if (deadline?.emailUrl) {
        chrome.tabs.create({ url: deadline.emailUrl });
      }
    });

    chrome.notifications.clear(notificationId);
  }

  function handleNotificationButtonClick(notificationId, buttonIndex) {
    if (!notificationId.startsWith('deadlineos_')) return;

    const parts = notificationId.replace('deadlineos_', '').split('_');
    let deadlineId;

    if (parts[0] === 'overdue') {
      deadlineId = parts.slice(1).join('_');
    } else {
      deadlineId = parts.slice(0, -1).join('_');
    }

    if (buttonIndex === 0) {
      // Button 1: Open Email
      Storage.getAllDeadlines().then(deadlines => {
        const deadline = deadlines.find(d => d.id === deadlineId);
        if (deadline?.emailUrl) {
          chrome.tabs.create({ url: deadline.emailUrl });
        }
      });
    } else if (buttonIndex === 1) {
      // Button 2: Mark Done
      Storage.updateDeadlineStatus(deadlineId, 'done').then(() => {
        console.log('[Notifier] Marked done via notification:', deadlineId);
        // Cancel remaining alarms for this deadline
        cancelReminders(deadlineId);
      });
    }

    chrome.notifications.clear(notificationId);
  }

  // ── Cancel reminders for a deadline ────────────────────────────────

  function cancelReminders(deadlineId) {
    for (const minutes of REMINDER_INTERVALS) {
      const alarmName = `deadline_${deadlineId}_${minutes}`;
      chrome.alarms.clear(alarmName, (cleared) => {
        if (cleared) {
          console.log('[Notifier] Cancelled alarm:', alarmName);
        }
      });
    }
  }

  // ── Reschedule all reminders ───────────────────────────────────────
  // Called on service worker startup to restore alarms that were lost
  // when the SW was killed by MV3 idle termination.

  async function rescheduleAll() {
    console.log('[Notifier] Rescheduling all reminders...');
    try {
      const deadlines = await Storage.getAllDeadlines();
      const activeDeadlines = deadlines.filter(d =>
        d.status !== 'done' && d.status !== 'dismissed' && d.deadline
      );

      let total = 0;
      for (const deadline of activeDeadlines) {
        const deadlineTime = new Date(deadline.deadline).getTime();
        if (deadlineTime > Date.now()) {
          await scheduleReminders(deadline);
          total++;
        }
      }

      console.log(`[Notifier] Rescheduled reminders for ${total} active deadlines`);
    } catch (e) {
      console.error('[Notifier] Failed to reschedule:', e.message);
    }
  }

  return {
    scheduleReminders,
    handleAlarm,
    handleNotificationClick,
    handleNotificationButtonClick,
    cancelReminders,
    rescheduleAll,
  };

})();
