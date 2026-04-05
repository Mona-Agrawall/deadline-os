// background/scorer.js
// Takes a parsed result and assigns a confidence score 0.0 → 1.0
// Also assigns an ACTION: 'ignore' | 'confirm' | 'auto_save'

const Scorer = (() => {

  // ── Scoring weights ────────────────────────────────────────────────
  // Each signal adds to the confidence score.
  // Max possible raw score is around 10 — we normalize to 0-1.

  const WEIGHTS = {
    // Category detection
    STRONG_CATEGORY_MATCH: 2.5,   // e.g. found "interview" or "deadline"
    WEAK_CATEGORY_MATCH: 0.8,     // e.g. found "position" or "submission"

    // Date evidence
    FUTURE_DATE_FOUND: 2.0,       // found a date that's in the future
    DATE_IN_CONTEXT: 1.0,         // date appears near deadline language
    PAST_DATE_ONLY: -1.0,         // only past dates found (likely informational)
    NO_DATE_FOUND: -2.0,          // no date at all

    // Urgency
    URGENCY_CRITICAL: 1.5,
    URGENCY_HIGH: 1.0,
    URGENCY_MEDIUM: 0.3,
    URGENCY_NORMAL: 0.0,
    URGENCY_LOW: -0.5,

    // Sender trust signals
    KNOWN_COMPANY_DOMAIN: 0.5,    // non-gmail/yahoo/hotmail sender
    PERSONAL_DOMAIN: -0.3,        // gmail.com sender for deadline = suspicious

    // Subject signals
    DEADLINE_IN_SUBJECT: 1.5,     // "deadline" / "interview" in subject itself
    ACTION_WORD_IN_SUBJECT: 0.8,  // "submit", "confirm", "complete" in subject

    // Anti-spam / newsletter signals
    NEWSLETTER_PENALTY: -3.0,     // "unsubscribe" in body = almost certainly a newsletter
    MARKETING_DOMAIN_PENALTY: -2.5, // known newsletter/ad sender domain
    PROMOTIONAL_SUBJECT: -2.0,    // subject looks like an ad/article title
  };

  const ACTION_THRESHOLDS = {
    AUTO_SAVE: 0.72,   // High confidence → create calendar event automatically
    CONFIRM: 0.55,     // Medium → ask user first (raised from 0.40 to filter noise)
    IGNORE: 0.0,       // Low → silently ignore
  };

  const SUBJECT_DEADLINE_WORDS = [
    'deadline', 'interview', 'due', 'submission', 'payment', 'application',
    'expires', 'last date', 'reminder', 'urgent', 'action required', 'schedule'
  ];

  const SUBJECT_ACTION_WORDS = [
    'submit', 'confirm', 'complete', 'respond', 'register', 'apply',
    'attend', 'join', 'sign', 'pay', 'upload', 'fill'
  ];

  const PERSONAL_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];

  // Trusted educational/institutional domains → higher confidence boost
  const COLLEGE_DOMAINS = ['srmist.edu.in', 'srm.edu.in', 'srmuniv.ac.in'];
  const CAREER_DOMAINS = [
    'haveloc.com', 'hirevue.com', 'hackerrank.com', 'codility.com',
    'jpmorganchase.com', 'jpmorgan.com', 'capgemini.com', 'philips.com',
    'autodesk.com', 'leapfinance.com', 'naukri.com', 'internshala.com',
    'unstop.com', 'dare2compete.com',
  ];

  // Newsletter / marketing / ad sender domains → heavy penalty
  const MARKETING_DOMAINS = [
    'linkedin.com', 'medium.com', 'substack.com', 'mailchimp.com',
    'sendgrid.net', 'hubspot.com', 'constantcontact.com',
    'quora.com', 'twitter.com', 'x.com', 'facebook.com', 'meta.com',
    'youtube.com', 'google.com', 'amazonses.com',
    'beehiiv.com', 'convertkit.com', 'drip.com', 'sendinblue.com',
    'mailgun.org', 'mandrillapp.com', 'campaignmonitor.com',
    'geeksforgeeks.org', 'leetcode.com', 'dev.to',
    'notion.so', 'figma.com', 'canva.com', 'grammarly.com',
    'ollama.com', 'ironwood.com',
  ];

  // Words that indicate a newsletter/promotional/article email (not a deadline)
  const NEWSLETTER_SUBJECT_WORDS = [
    'newsletter', 'digest', 'weekly roundup', 'monthly update',
    'introducing', 'announcing', 'what\'s new', 'product update',
    'is now', 'is here', 'just launched', 'check out',
    'blog post', 'article', 'guide to', 'tips for',
    'redefined', 'reimagined', 'powered by', 'how to',
    'top picks', 'trending', 'best of', 'curated',
    'don\'t miss out', 'exclusive offer', 'sale', 'discount',
    'free trial', 'upgrade', 'premium',
  ];

  function score(parsed) {
    if (!parsed) return { score: 0, action: 'ignore', reasons: [] };

    let raw = 0;
    const reasons = [];

    // ── 1. Category score ──────────────────────────────────────────
    const catData = parsed.categoryMatches[parsed.category];
    if (catData) {
      if (catData.strongHits > 0) {
        raw += WEIGHTS.STRONG_CATEGORY_MATCH;
        reasons.push(`Strong category match: ${parsed.category} (${catData.matchedKeywords.slice(0,2).join(', ')})`);
      } else {
        raw += WEIGHTS.WEAK_CATEGORY_MATCH;
        reasons.push(`Weak category match: ${parsed.category}`);
      }
    }

    // ── 2. Date score ──────────────────────────────────────────────
    if (parsed.dateCandidates.length === 0) {
      raw += WEIGHTS.NO_DATE_FOUND;
      reasons.push('No date found in email');
    } else {
      const futureDates = parsed.dateCandidates.filter(d => d.isFuture);
      if (futureDates.length > 0) {
        raw += WEIGHTS.FUTURE_DATE_FOUND;
        reasons.push(`Future date found: ${futureDates[0].raw}`);
      } else {
        raw += WEIGHTS.PAST_DATE_ONLY;
        reasons.push('Only past dates found');
      }
    }

    // ── 3. Urgency score ───────────────────────────────────────────
    const urgencyKey = `URGENCY_${parsed.urgency}`;
    raw += WEIGHTS[urgencyKey] || 0;
    if (parsed.urgency !== 'NORMAL') {
      reasons.push(`Urgency signal: ${parsed.urgency}`);
    }

    // ── 4. Sender trust ────────────────────────────────────────────
    if (parsed.senderDomain) {
      if (COLLEGE_DOMAINS.some(d => parsed.senderDomain.endsWith(d))) {
        // College/university emails — high trust, boost significantly
        raw += WEIGHTS.KNOWN_COMPANY_DOMAIN + 1.8; // +0.20 effective after normalization
        reasons.push(`College domain boost: ${parsed.senderDomain}`);
      } else if (CAREER_DOMAINS.some(d => parsed.senderDomain.endsWith(d))) {
        // Career/recruitment platform — boost moderately
        raw += WEIGHTS.KNOWN_COMPANY_DOMAIN + 1.35; // +0.15 effective after normalization
        reasons.push(`Career platform boost: ${parsed.senderDomain}`);
      } else if (PERSONAL_DOMAINS.includes(parsed.senderDomain)) {
        raw += WEIGHTS.PERSONAL_DOMAIN;
        reasons.push('Sender uses personal email domain');
      } else {
        raw += WEIGHTS.KNOWN_COMPANY_DOMAIN;
        reasons.push(`Trusted sender domain: ${parsed.senderDomain}`);
      }
    }

    // ── 5. Subject quality ─────────────────────────────────────────
    const subjectLower = (parsed.emailSubject || '').toLowerCase();

    const hasDeadlineWord = SUBJECT_DEADLINE_WORDS.some(w => subjectLower.includes(w));
    if (hasDeadlineWord) {
      raw += WEIGHTS.DEADLINE_IN_SUBJECT;
      reasons.push('Deadline keyword in subject');
    }

    const hasActionWord = SUBJECT_ACTION_WORDS.some(w => subjectLower.includes(w));
    if (hasActionWord && !hasDeadlineWord) {
      raw += WEIGHTS.ACTION_WORD_IN_SUBJECT;
      reasons.push('Action word in subject');
    }

    // ── 6. Newsletter / spam detection ─────────────────────────────
    // This is critical — newsletters and ads often contain deadline-like
    // words ("apply", "register", "join") but are NOT real deadlines.

    const fullBody = (parsed.emailSubject + ' ' + (parsed.body || '')).toLowerCase();

    // Check for "unsubscribe" — the #1 signal for newsletters/marketing
    if (fullBody.includes('unsubscribe') || fullBody.includes('email preferences') ||
        fullBody.includes('opt out') || fullBody.includes('manage subscriptions') ||
        fullBody.includes('no longer wish to receive')) {
      raw += WEIGHTS.NEWSLETTER_PENALTY;
      reasons.push('Newsletter detected (unsubscribe link found)');
    }

    // Check for known marketing sender domains
    if (parsed.senderDomain && MARKETING_DOMAINS.some(d => parsed.senderDomain.endsWith(d))) {
      raw += WEIGHTS.MARKETING_DOMAIN_PENALTY;
      reasons.push(`Marketing sender: ${parsed.senderDomain}`);
    }

    // Check for promotional subject patterns
    const hasPromoSubject = NEWSLETTER_SUBJECT_WORDS.some(w => subjectLower.includes(w));
    if (hasPromoSubject) {
      raw += WEIGHTS.PROMOTIONAL_SUBJECT;
      reasons.push('Promotional subject pattern detected');
    }

    // Penalize "no-reply" senders — often automated/marketing
    const senderEmailLower = (parsed.senderEmail || '').toLowerCase();
    if (senderEmailLower.includes('noreply') || senderEmailLower.includes('no-reply') ||
        senderEmailLower.includes('notifications@') || senderEmailLower.includes('newsletter@') ||
        senderEmailLower.includes('marketing@') || senderEmailLower.includes('updates@') ||
        senderEmailLower.includes('digest@') || senderEmailLower.includes('info@')) {
      raw -= 1.0;
      reasons.push('Automated/no-reply sender');
    }

    // ── 7. Normalize to 0-1 ────────────────────────────────────────
    // Max theoretical raw ≈ 9.3, so divide by 9 and clamp
    const normalized = Math.max(0, Math.min(1, raw / 9));

    // ── 7. Determine action ────────────────────────────────────────
    let action;
    if (normalized >= ACTION_THRESHOLDS.AUTO_SAVE) {
      action = 'auto_save';
    } else if (normalized >= ACTION_THRESHOLDS.CONFIRM) {
      action = 'confirm';
    } else {
      action = 'ignore';
    }

    return {
      score: parseFloat(normalized.toFixed(3)),
      action,
      reasons,
      category: parsed.category,
      urgency: parsed.urgency,
      deadline: parsed.deadline,
      deadlineRaw: parsed.deadlineRaw,
      deadlineDaysFromNow: parsed.deadlineDaysFromNow,
      emailSubject: parsed.emailSubject,
      senderName: parsed.senderName,
      senderEmail: parsed.senderEmail,
      emailUrl: parsed.emailUrl,
    };
  }

  return { score, ACTION_THRESHOLDS };
})();