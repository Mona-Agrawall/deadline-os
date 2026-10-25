// utils/sender-domains.js
// Lists of sender domains used to trust, penalise or skip emails.
// Shared by the service worker (scanner + scorer) and the popup.

const SenderDomains = (() => {

  // College / university — highest trust
  const COLLEGE = ['srmist.edu.in', 'srm.edu.in', 'srmuniv.ac.in'];

  // Placement platforms and recruiting companies — high trust
  const CAREER = [
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

  // True if `domain` is one of `list` or a subdomain of one (e.g. mail.srmist.edu.in)
  function matches(domain, list) {
    if (!domain) return false;
    return list.some(d => domain === d || domain.endsWith(`.${d}`));
  }

  function isTrusted(domain) {
    return matches(domain, COLLEGE) || matches(domain, CAREER);
  }

  return { COLLEGE, CAREER, PERSONAL, MARKETING, BLOCKED, matches, isTrusted };
})();
