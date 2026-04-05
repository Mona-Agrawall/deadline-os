// background/parser.js
// Scans email subject + body for deadline signals.
// Returns a structured DeadlineCandidate or null.
// Rule-based first — deterministic and trustworthy.

// Must be imported before scorer.js in service-worker.js

const Parser = (() => {

  // ── Category keyword maps ──────────────────────────────────────────
  // Each category has STRONG triggers (high confidence) and
  // WEAK triggers (need corroboration from date evidence)

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

  // ── Date-bearing phrase patterns ───────────────────────────────────
  // These are phrases that typically PRECEDE or CONTAIN a date
  const DATE_CONTEXT_PATTERNS = [
    // Explicit deadline language
    /(?:due|deadline|by|before|submit(?:ted)?\s+by|no\s+later\s+than|closes?\s+on|ends?\s+on)\s*[:\-]?\s*([^.\n]{3,40})/gi,
    // Scheduled time language
    /(?:scheduled\s+(?:for|on)|at|on|starts?\s+(?:at|on))\s+([^.\n]{3,40})/gi,
    // Date-first patterns
    /(?:date\s*[:\-]\s*)([^.\n]{3,40})/gi,
    // "by [date]" patterns
    /\bby\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}[^.\n]{0,20})/gi,
    // ISO and slash dates standalone
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/gi,
    // "April 5", "5th April" patterns
    /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*(?:\s*,?\s*\d{4})?)\b/gi,
    /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?)\b/gi,
    // Relative dates
    /\b(today|tomorrow|this\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+\d+\s+days?)\b/gi,
    // "Complete by", "expires on", "link valid till" — HireVue / interview platforms
    /(?:complete\s+by|expires?\s+on|valid\s+(?:till|until|through)|available\s+(?:till|until))\s*[:\-]?\s*([^.\n]{3,40})/gi,
    // "last date" standalone
    /(?:last\s+date)\s*[:\-]?\s*([^.\n]{3,40})/gi,
  ];

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

  function extractDateCandidates(text) {
    const found = new Set();
    const candidates = [];

    for (const pattern of DATE_CONTEXT_PATTERNS) {
      pattern.lastIndex = 0; // Reset global regex
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const raw = (match[1] || match[0]).trim();
        if (raw.length < 3 || raw.length > 60) continue;
        if (found.has(raw.toLowerCase())) continue;
        found.add(raw.toLowerCase());

        const parsed = DateUtils.parse(raw);
        if (parsed) {
          candidates.push({
            raw,
            date: parsed,
            isFuture: DateUtils.isInFuture(parsed),
            daysFromNow: DateUtils.daysFromNow(parsed),
          });
        }
      }
    }

    // Sort: prefer future dates, then soonest first
    candidates.sort((a, b) => {
      if (a.isFuture && !b.isFuture) return -1;
      if (!a.isFuture && b.isFuture) return 1;
      return a.date - b.date;
    });

    return candidates;
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

  // ── Main parse function ────────────────────────────────────────────

  function parse(emailData) {
    if (!emailData) return null;

    const fullText = `${emailData.subject || ''}\n${emailData.body || ''}`;

    // 1. Find category matches
    const categoryMatches = findCategoryMatches(fullText);
    const category = pickBestCategory(categoryMatches);

    // 2. Extract date candidates from body
    const dateCandidates = extractDateCandidates(fullText);
    const bestDate = dateCandidates[0] || null;

    // 3. Detect urgency
    const urgency = detectUrgency(fullText);

    // 4. Extract sender info
    const senderDomain = emailData.sender?.email
      ? emailData.sender.email.split('@')[1] || null
      : null;

    // 5. Build result
    const result = {
      // Source
      emailSubject: emailData.subject,
      senderName: emailData.sender?.name,
      senderEmail: emailData.sender?.email,
      senderDomain,
      receivedDate: emailData.receivedDate,
      emailUrl: emailData.url,

      // Extracted
      category: category || 'UNKNOWN',
      categoryMatches,
      dateCandidates,
      deadline: bestDate ? bestDate.date.toISOString() : null,
      deadlineRaw: bestDate ? bestDate.raw : null,
      deadlineDaysFromNow: bestDate ? bestDate.daysFromNow : null,
      urgency,

      // Meta
      body: emailData.body || '',  // Pass through for scorer's newsletter detection
      parsedAt: new Date().toISOString(),
    };

    return result;
  }

  return { parse };
})();