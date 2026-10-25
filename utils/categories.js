// utils/categories.js
// Emoji for each deadline category.
// Shared by the service worker and the Gmail content scripts.

const CATEGORY_EMOJI = {
  INTERVIEW: '🎯',
  ASSIGNMENT: '📝',
  PAYMENT: '💳',
  APPLICATION: '📋',
  EVENT: '📅',
  REMINDER: '🔔',
  UNKNOWN: '⏰',
};

function getCategoryEmoji(category) {
  return CATEGORY_EMOJI[category] || CATEGORY_EMOJI.UNKNOWN;
}
