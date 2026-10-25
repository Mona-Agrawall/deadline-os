// background/email-pipeline.js
// The path every email takes, whether it was opened in Gmail (content
// script) or found by a background inbox scan (Gmail API):
//
//   fingerprint → skip duplicates → parse → score → save
//   → schedule reminders → add to calendar (high-confidence only)

const EmailPipeline = (() => {

  function buildDeadline(id, parsed, score, action, source) {
    return {
      id,
      subject: parsed.emailSubject,
      senderName: parsed.senderName,
      senderEmail: parsed.senderEmail,
      category: parsed.category,
      deadline: parsed.deadline,
      deadlineRaw: parsed.deadlineRaw,
      urgency: parsed.urgency,
      score,
      action,
      emailUrl: parsed.emailUrl,
      savedAt: new Date().toISOString(),
      status: action === 'auto_save' ? 'pending' : 'confirm',
      calendarEventId: null,
      source,
    };
  }

  // source: 'dom' | 'gmail_api'
  // Returns { status: 'duplicate' | 'ignored' | 'saved', ... }
  async function processEmail(emailData, source) {
    const id = Deduplicator.fingerprint(emailData);
    if (await Deduplicator.isDuplicate(id)) return { status: 'duplicate' };

    const settings = await Settings.get();
    const parsed = Parser.parse(emailData, { dateOrder: settings.dateOrder });
    const { score, action, reasons } = Scorer.score(parsed, settings);
    console.log(`[Pipeline] "${emailData.subject}" → ${parsed.category} (${score}) → ${action}`, reasons);

    if (action === 'ignore') return { status: 'ignored', score };

    const deadline = buildDeadline(id, parsed, score, action, source);
    const { saved } = await Storage.saveDeadline(deadline);
    await Deduplicator.markProcessed(id);
    if (!saved) return { status: 'duplicate' };

    Notifier.scheduleReminders(deadline, settings.reminderMinutes);
    if (action === 'auto_save') {
      await CalendarSync.syncDeadline(id);
    }

    return { status: 'saved', deadline };
  }

  return { processEmail };
})();
