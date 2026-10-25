// background/parser.js
// Reads an email's subject + body and extracts deadline signals:
// category, candidate dates, and urgency. Purely rule-based, so the
// result is deterministic and easy to reason about.

const Parser = (() => {

  // ── Category keywords ──────────────────────────────────────────────
  // STRONG keywords are enough on their own; WEAK ones need two or more hits.

  const CATEGORIES = {
    INTERVIEW: {
      strong: [
        'interview', 'interview scheduled', 'interview confirmation',
        'interview invite', 'virtual interview', 'phone screen',
        'hiring assessment', 'hirevue', 'codility', 'hackerrank assessment',
        'technical round', 'hr round', 'recruiter call'
      ],
      weak: [
        'opportunity', 'role', 'position', 'candidacy', 'shortlisted',
        'next steps', 'recruiter'
      ]
    },
    ASSIGNMENT: {
      strong: [
        'assignment due', 'submission deadline', 'submit by', 'due date',
        'assignment submission', 'homework due', 'project deadline',
        'turn in', 'upload by', 'last date to submit', 'quiz',
        'exam schedule', 'test on', 'viva', 'lab submission',
        'end sem', 'mid sem', 'cia', 'cia exam', 'cia test',
        'lab evaluation', 'viva voce', 'internal assessment',
        'attendance shortage', 'attendance warning',
        'registration last date', 'course registration'
      ],
      weak: [
        'assignment', 'homework', 'project', 'submission', 'course',
        'professor', 'faculty', 'class', 'semester',
        'attendance', 'lab', 'practical', 'evaluation'
      ]
    },
    PAYMENT: {
      strong: [
        'payment due', 'pay by', 'invoice due', 'fee payment',
        'last date for payment', 'tuition due', 'hostel fee',
        'overdue', 'pending payment', 'amount due', 'pay before',
        'transaction', 'bill due', 'emi due',
        'fee due', 'challan', 'mess fee', 'library fine',
        'exam fee', 'semester fee', 'tuition fee',
        'registration fee', 'hostel dues', 'last date to pay'
      ],
      weak: [
        'payment', 'fee', 'invoice', 'amount', 'charges', 'subscription',
        'challan', 'dues', 'fine', 'receipt'
      ]
    },
    APPLICATION: {
      strong: [
        'application deadline', 'apply by', 'apply before', 'last date to apply',
        'application closes', 'registration deadline', 'register by',
        'enrollment deadline', 'form submission', 'application window closes',
        'registration closes', 'register before', 'last date to register',
        'seats filling fast', 'limited seats', 'registration closes at midnight',
        'shortlisted', 'placement drive', 'campus recruitment',
        'off-campus drive', 'off campus drive', 'ppo', 'pre-placement offer'
      ],
      weak: [
        'application', 'apply', 'register', 'enrollment', 'form', 'portal',
        'placement', 'internship', 'intern', 'drive', 'career',
        'recruitment', 'opportunity', 'walk-in'
      ]
    },
    EVENT: {
      strong: [
        'event on', 'meeting at', 'scheduled for', 'join us on',
        'webinar', 'seminar on', 'conference', 'orientation on',
        'session at', 'workshop on', 'hackathon', 'fest', 'ceremony'
      ],
      weak: [
        'event', 'meeting', 'session', 'workshop', 'webinar', 'online'
      ]
    },
    REMINDER: {
      strong: [
        'reminder:', 'gentle reminder', 'friendly reminder',
        'action required', 'urgent:', 'please respond', 'response needed',
        'follow up', 'don\'t forget', 'important notice'
      ],
      weak: [
        'reminder', 'urgent', 'important', 'action', 'required'
      ]
    }
  };

  // Words that, shortly before a date, mark it as the deadline itself
  // ("due 15 March", "last date: 12/03") rather than an incidental date.
  const DEADLINE_CONTEXT_REGEX =
    /\b(due|deadline|by|before|until|till|no later than|last date|closes?|ends?|expires?|valid|submit|scheduled|starts?|on|at|date)\b[^.\n]{0,25}$/i;
  const CONTEXT_CHARS = 40;

  // ── Urgency signals ────────────────────────────────────────────────
  const URGENCY_SIGNALS = {
    CRITICAL: ['today', 'tonight', 'in a few hours', 'within 24 hours', 'asap', 'immediately', 'urgent'],
    HIGH: ['tomorrow', 'this week', 'in 2 days', 'in 3 days', 'don\'t wait', 'as soon as possible'],
    MEDIUM: ['next week', 'this month', 'upcoming', 'soon'],
    LOW: ['eventually', 'when possible', 'no rush']
  };

  // ── Helpers ────────────────────────────────────────────────────────

  function normalizeText(text) {
    return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function findCategoryMatches(text) {
    const normalized = normalizeText(text);
    const results = {};

    for (const [category, patterns] of Object.entries(CATEGORIES)) {
      let strongHits = 0;
      let weakHits = 0;
      const matchedKeywords = [];

      for (const keyword of patterns.strong) {
        if (normalized.includes(keyword)) {
          strongHits++;
          matchedKeywords.push(keyword);
        }
      }
      for (const keyword of patterns.weak) {
        if (normalized.includes(keyword)) {
          weakHits++;
        }
      }

      if (strongHits > 0 || weakHits >= 2) {
        results[category] = { strongHits, weakHits, matchedKeywords };
      }
    }

    return results;
  }

  // All dates in the text, best first: future before past, deadline
  // wording before incidental mentions, then soonest first
  function extractDateCandidates(text, { dateOrder, now = new Date() }) {
    const candidates = DateParser.findDates(text, { dateOrder, now }).map(({ raw, date, index }) => ({
      raw,
      date,
      isFuture: date > now,
      inContext: DEADLINE_CONTEXT_REGEX.test(text.slice(Math.max(0, index - CONTEXT_CHARS), index)),
    }));

    return candidates.sort((a, b) =>
      (b.isFuture - a.isFuture) || (b.inContext - a.inContext) || (a.date - b.date)
    );
  }

  function detectUrgency(text) {
    const normalized = normalizeText(text);
    for (const [level, signals] of Object.entries(URGENCY_SIGNALS)) {
      for (const signal of signals) {
        if (normalized.includes(signal)) return level;
      }
    }
    return 'NORMAL';
  }

  function pickBestCategory(categoryMatches) {
    let best = null;
    let bestScore = 0;

    for (const [cat, data] of Object.entries(categoryMatches)) {
      const score = data.strongHits * 3 + data.weakHits;
      if (score > bestScore) {
        bestScore = score;
        best = cat;
      }
    }

    return best;
  }

  // ── Main ───────────────────────────────────────────────────────────

  // options: { dateOrder: 'DMY' | 'MDY', now?: Date }
  function parse(emailData, options = {}) {
    const fullText = `${emailData.subject || ''}\n${emailData.body || ''}`;

    const categoryMatches = findCategoryMatches(fullText);
    const dateCandidates = extractDateCandidates(fullText, options);
    const bestDate = dateCandidates[0] || null;
    const senderEmail = emailData.sender?.email;

    return {
      // From the email
      emailSubject: emailData.subject,
      senderName: emailData.sender?.name,
      senderEmail,
      senderDomain: SenderDomains.getDomain(senderEmail),
      emailUrl: emailData.url,
      body: emailData.body || '',

      // Extracted signals
      category: pickBestCategory(categoryMatches) || 'UNKNOWN',
      categoryMatches,
      dateCandidates,
      deadline: bestDate ? bestDate.date.toISOString() : null,
      deadlineRaw: bestDate ? bestDate.raw : null,
      urgency: detectUrgency(fullText),
    };
  }

  return { parse };
})();
