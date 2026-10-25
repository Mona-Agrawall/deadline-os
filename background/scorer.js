// background/scorer.js
// Turns the parser's signals into a confidence score (0.0 – 1.0) and an
// action: 'auto_save' | 'confirm' | 'ignore'.
//
// Every signal adds or subtracts a weight from a raw total, which is then
// normalised. `reasons` records which signals fired, for debugging.

const Scorer = (() => {

  const WEIGHTS = {
    // Category keywords
    STRONG_CATEGORY_MATCH: 3.0,     // e.g. "interview", "submission deadline"
    WEAK_CATEGORY_MATCH: 0.5,       // e.g. "position", "submission"

    // Date evidence
    FUTURE_DATE_FOUND: 2.0,
    PAST_DATE_ONLY: -1.5,           // likely informational, not a deadline
    NO_DATE_FOUND: -2.5,

    // Urgency (keys match the parser's urgency levels)
    URGENCY_CRITICAL: 1.5,
    URGENCY_HIGH: 1.0,
    URGENCY_MEDIUM: 0.3,
    URGENCY_NORMAL: 0.0,
    URGENCY_LOW: -0.5,

    // Sender
    COLLEGE_DOMAIN: 2.3,
    CAREER_DOMAIN: 1.85,
    COMPANY_DOMAIN: 0.5,            // any other non-personal domain
    PERSONAL_DOMAIN: -0.5,          // gmail.com etc.
    AUTOMATED_SENDER: -1.5,         // noreply@, newsletter@, ...

    // Subject
    DEADLINE_IN_SUBJECT: 1.5,
    ACTION_WORD_IN_SUBJECT: 0.8,

    // Newsletter / marketing
    NEWSLETTER: -4.0,               // has an unsubscribe link
    MARKETING_DOMAIN: -3.5,
    PROMOTIONAL_SUBJECT: -3.0,
    ENGAGEMENT_BAIT: -2.5,

    // Placement boosts
    HAVELOC: 2.5,
    PLACEMENT_KEYWORD: 1.5,
  };

  // Raw totals rarely exceed ~12, so this maps them onto 0 – 1
  const NORMALIZATION_DIVISOR = 11;

  const ACTION_THRESHOLDS = {
    AUTO_SAVE: 0.72,                // save + add to calendar automatically
    CONFIRM: 0.60,                  // save, but ask the user to confirm
  };

  const SUBJECT_DEADLINE_WORDS = [
    'deadline', 'interview', 'due', 'submission', 'payment', 'application',
    'expires', 'last date', 'reminder', 'urgent', 'action required', 'schedule',
  ];

  const SUBJECT_ACTION_WORDS = [
    'submit', 'confirm', 'complete', 'respond', 'register', 'apply',
    'attend', 'join', 'sign', 'pay', 'upload', 'fill',
  ];

  const UNSUBSCRIBE_PHRASES = [
    'unsubscribe', 'email preferences', 'opt out',
    'manage subscriptions', 'no longer wish to receive',
  ];

  const AUTOMATED_SENDER_MARKERS = [
    'noreply', 'no-reply', 'notifications@', 'newsletter@',
    'marketing@', 'updates@', 'digest@', 'info@',
  ];

  const PROMOTIONAL_SUBJECT_WORDS = [
    'newsletter', 'digest', 'weekly roundup', 'monthly update',
    'introducing', 'announcing', 'what\'s new', 'product update',
    'is now', 'is here', 'just launched', 'check out',
    'blog post', 'article', 'guide to', 'tips for',
    'redefined', 'reimagined', 'powered by', 'how to',
    'top picks', 'trending', 'best of', 'curated',
    'don\'t miss out', 'exclusive offer', 'sale', 'discount',
    'free trial', 'upgrade', 'premium',
    'new on', 'explore', 'discover', 'you might like',
    'recommended for you', 'based on your', 'people also',
    'jobs you might', 'courses for you', 'learn more',
  ];

  // Phrases platforms use to drive clicks — two or more means engagement bait
  const ENGAGEMENT_BAIT_PHRASES = [
    'view profile', 'connect with', 'explore opportunities',
    'see who viewed', 'your network', 'skill assessment',
    'endorse', 'congratulate', 'new jobs for you',
    'based on your profile', 'people you may know',
    'complete your profile', 'add to your feed',
    'trending in your network', 'join the conversation',
    'you appeared in', 'your post', 'someone commented',
    'start learning', 'unlock', 'claim your',
    'we miss you', 'come back to', 'it\'s been a while',
  ];

  const PLACEMENT_SUBJECT_SIGNALS = [
    'haveloc', 'placement drive', 'campus recruitment',
    'interview scheduled', 'interview invitation', 'interview confirmation',
    'shortlisted', 'selected for', 'offer letter',
    'pre-placement offer', 'ppo', 'off-campus drive',
    'hiring challenge', 'coding challenge', 'assessment link',
  ];

  const containsAny = (text, phrases) => phrases.some(p => text.includes(p));

  // settings: { collegeDomains, careerDomains } — see background/settings.js
  function score(parsed, settings) {
    let raw = 0;
    const reasons = [];
    const add = (weight, reason) => {
      raw += weight;
      reasons.push(reason);
    };

    const domain = parsed.senderDomain;
    const subject = (parsed.emailSubject || '').toLowerCase();
    const fullText = `${parsed.emailSubject} ${parsed.body || ''}`.toLowerCase();
    const senderEmail = (parsed.senderEmail || '').toLowerCase();

    // 1. Category
    const categoryMatch = parsed.categoryMatches[parsed.category];
    if (categoryMatch) {
      if (categoryMatch.strongHits > 0) {
        add(WEIGHTS.STRONG_CATEGORY_MATCH,
          `Strong category match: ${parsed.category} (${categoryMatch.matchedKeywords.slice(0, 2).join(', ')})`);
      } else {
        add(WEIGHTS.WEAK_CATEGORY_MATCH, `Weak category match: ${parsed.category}`);
      }
    }

    // 2. Date
    const futureDate = parsed.dateCandidates.find(d => d.isFuture);
    if (parsed.dateCandidates.length === 0) {
      add(WEIGHTS.NO_DATE_FOUND, 'No date found in email');
    } else if (futureDate) {
      add(WEIGHTS.FUTURE_DATE_FOUND, `Future date found: ${futureDate.raw}`);
    } else {
      add(WEIGHTS.PAST_DATE_ONLY, 'Only past dates found');
    }

    // 3. Urgency
    raw += WEIGHTS[`URGENCY_${parsed.urgency}`] || 0;
    if (parsed.urgency !== 'NORMAL') {
      reasons.push(`Urgency signal: ${parsed.urgency}`);
    }

    // 4. Sender trust
    if (domain) {
      if (SenderDomains.matches(domain, settings.collegeDomains)) {
        add(WEIGHTS.COLLEGE_DOMAIN, `College domain: ${domain}`);
      } else if (SenderDomains.matches(domain, settings.careerDomains)) {
        add(WEIGHTS.CAREER_DOMAIN, `Career platform: ${domain}`);
      } else if (SenderDomains.PERSONAL.includes(domain)) {
        add(WEIGHTS.PERSONAL_DOMAIN, 'Personal email domain');
      } else {
        add(WEIGHTS.COMPANY_DOMAIN, `Company domain: ${domain}`);
      }
    }

    // 5. Subject keywords (deadline word wins over action word)
    if (containsAny(subject, SUBJECT_DEADLINE_WORDS)) {
      add(WEIGHTS.DEADLINE_IN_SUBJECT, 'Deadline keyword in subject');
    } else if (containsAny(subject, SUBJECT_ACTION_WORDS)) {
      add(WEIGHTS.ACTION_WORD_IN_SUBJECT, 'Action word in subject');
    }

    // 6. Newsletter / marketing — these often contain words like "apply"
    //    or "register" but are not real deadlines
    if (containsAny(fullText, UNSUBSCRIBE_PHRASES)) {
      add(WEIGHTS.NEWSLETTER, 'Newsletter (unsubscribe link)');
    }
    if (SenderDomains.matches(domain, SenderDomains.MARKETING)) {
      add(WEIGHTS.MARKETING_DOMAIN, `Marketing sender: ${domain}`);
    }
    if (containsAny(subject, PROMOTIONAL_SUBJECT_WORDS)) {
      add(WEIGHTS.PROMOTIONAL_SUBJECT, 'Promotional subject');
    }
    if (containsAny(senderEmail, AUTOMATED_SENDER_MARKERS) && !SenderDomains.isTrusted(domain, settings)) {
      add(WEIGHTS.AUTOMATED_SENDER, 'Automated / no-reply sender');
    }

    const baitHits = ENGAGEMENT_BAIT_PHRASES.filter(p => fullText.includes(p)).length;
    if (baitHits >= 2) {
      add(WEIGHTS.ENGAGEMENT_BAIT, `Engagement bait (${baitHits} phrases)`);
    }

    // 7. Placement boosts — so placement emails are never missed
    const mentionsHaveloc = subject.includes('haveloc');
    if (mentionsHaveloc || SenderDomains.matches(domain, ['haveloc.com'])) {
      add(WEIGHTS.HAVELOC, 'Haveloc email');
    }
    if (!mentionsHaveloc && containsAny(subject, PLACEMENT_SUBJECT_SIGNALS)) {
      add(WEIGHTS.PLACEMENT_KEYWORD, 'Placement/interview signal in subject');
    }

    // 8. Normalise and pick an action
    const normalized = Math.max(0, Math.min(1, raw / NORMALIZATION_DIVISOR));

    let action = 'ignore';
    if (normalized >= ACTION_THRESHOLDS.AUTO_SAVE) action = 'auto_save';
    else if (normalized >= ACTION_THRESHOLDS.CONFIRM) action = 'confirm';

    return {
      score: parseFloat(normalized.toFixed(3)),
      action,
      reasons,
    };
  }

  return { score };
})();
