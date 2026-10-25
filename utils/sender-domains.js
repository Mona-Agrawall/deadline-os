// utils/sender-domains.js
// Sender domain lists used to trust, penalise or skip emails.
// The college and career lists are only defaults — users can change them
// on the settings page. Shared by the service worker and the popup.

const SenderDomains = (() => {

  const DEFAULT_COLLEGE = ['srmist.edu.in', 'srm.edu.in', 'srmuniv.ac.in'];

  const DEFAULT_CAREER = [
    'haveloc.com', 'hirevue.com', 'hackerrank.com', 'codility.com',
    'unstop.com', 'dare2compete.com', 'naukri.com', 'internshala.com',
    'jpmorganchase.com', 'jpmorgan.com', 'capgemini.com',
    'philips.com', 'autodesk.com', 'leapfinance.com',
  ];

  // Free email providers — a "deadline" from these is less trustworthy
  const PERSONAL = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];

  // Newsletter / marketing senders — penalised by the scorer
  const MARKETING = [
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

  // Platforms the inbox scanner skips without parsing
  const BLOCKED = [
    // Social media & content platforms
    'linkedin.com', 'medium.com', 'substack.com', 'quora.com',
    'twitter.com', 'x.com', 'facebook.com', 'meta.com',
    'youtube.com', 'reddit.com', 'pinterest.com', 'instagram.com',
    // Email marketing infrastructure
    'mailchimp.com', 'sendgrid.net', 'hubspot.com', 'constantcontact.com',
    'beehiiv.com', 'convertkit.com', 'drip.com', 'sendinblue.com',
    'mailgun.org', 'mandrillapp.com', 'campaignmonitor.com', 'amazonses.com',
    // Dev tools / learning platforms
    'geeksforgeeks.org', 'leetcode.com', 'dev.to',
    'notion.so', 'figma.com', 'canva.com', 'grammarly.com',
    'ollama.com', 'ironwood.com',
    // Other consumer platforms
    'github.com', 'gitlab.com', 'atlassian.com', 'slack.com',
    'discord.com', 'twitch.tv', 'spotify.com', 'netflix.com',
    'amazon.com', 'flipkart.com', 'myntra.com', 'swiggy.in', 'zomato.com',
  ];

  // True if `domain` is in `list` or is a subdomain of an entry (mail.srmist.edu.in)
  function matches(domain, list) {
    if (!domain) return false;
    return list.some(d => domain === d || domain.endsWith(`.${d}`));
  }

  // College and career senders are always processed and never penalised
  function isTrusted(domain, { collegeDomains, careerDomains }) {
    return matches(domain, collegeDomains) || matches(domain, careerDomains);
  }

  function getDomain(email) {
    return (email || '').toLowerCase().split('@')[1] || null;
  }

  return { DEFAULT_COLLEGE, DEFAULT_CAREER, PERSONAL, MARKETING, BLOCKED, matches, isTrusted, getDomain };
})();
