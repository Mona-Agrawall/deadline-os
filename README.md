<div align="center">

# ⏰ Deadline OS

**Your personal deadline operating system for Gmail.**

Deadline OS is a Chrome extension that automatically scans your Gmail inbox, intelligently detects academic and professional deadlines, and keeps you on top of everything — interviews, assignments, fee payments, applications, and more. No more hunting through emails; Deadline OS surfaces what matters, when it matters.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Vanilla JS](https://img.shields.io/badge/Built%20with-Vanilla%20JS-yellow.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

</div>

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Development Notes](#development-notes)
- [Roadmap](#roadmap)
- [Tech Stack](#tech-stack)
- [Permissions & Privacy](#permissions--privacy)
- [License](#license)
- [Author](#author)

---

## Features

### Smart Gmail Scanning

- **Background polling** every 30 minutes via the Gmail API — keeps your deadlines fresh without any manual effort
- **DOM-based real-time detection** triggers the moment you open an email in Gmail
- Processes up to **50 inbox messages per scan** with automatic rate-limiting

### Intelligent Deadline Detection

A **rule-based NLP parser** extracts deadline signals from email subjects and bodies, supporting:

- Diverse date formats: `April 5`, `05/04/2026`, `in 3 days`, `next Friday`, `tomorrow`
- Relative time expressions, ISO dates, and contextual patterns (`due by`, `submit before`, `closes on`)

A **confidence scoring engine (0.0 → 1.0)** then weighs multiple signals to decide what to do:

| Score Range | Action | Behavior |
|---|---|---|
| ≥ 0.72 | `auto_save` | Saved immediately and synced to calendar |
| 0.55 – 0.71 | `confirm` | Presented with a ⚠️ confirmation prompt |
| < 0.55 | `ignore` | Silently discarded |

Signals factored into the score include category keyword strength, date evidence, urgency level, sender domain trust, subject-line quality, and newsletter/spam penalties.

### Deadline Categories

| Category | Examples |
|---|---|
| 🎯 **Interview** | Interview confirmation, HireVue, phone screen, technical round |
| 📝 **Assignment** | Homework due, project deadline, CIA exam, viva, lab submission |
| 💳 **Payment** | Fee due, hostel dues, exam fee, mess fee, EMI |
| 📋 **Application** | Apply by, registration deadline, placement drive, PPO |
| 📅 **Event** | Webinar, seminar, hackathon, orientation, workshop |
| 🔔 **Reminder** | Gentle reminder, action required, urgent notices |

### Google Calendar Integration

- One-click **Connect Calendar** from the popup
- High-confidence deadlines are **automatically synced** as calendar events
- A **retry queue** handles failed syncs — retries every 10 minutes, up to 5 attempts
- Calendar event links are displayed directly on each deadline card

### Smart Notifications

- **Three-tier reminder system**: 24 hours, 1 hour, and 15 minutes before each deadline
- Persistent on-screen notifications for the 1-hour and 15-minute reminders
- **"Open Email"** and **"Mark Done"** action buttons directly from notifications
- Overdue deadlines trigger a 🚨 "OVERDUE" notification
- Alarms are **rescheduled on browser restart** to survive MV3 service worker termination

### Inbox Badge Injection

Colored emoji badges are injected next to matching Gmail inbox rows with visual urgency cues:

| Badge Style | Meaning |
|---|---|
| 🔴 Pulsing border | Overdue |
| 🟠 Solid border | Due today |
| 🟡 Solid border | Due this week |
| No border | Due later |

Badges update automatically via a **MutationObserver** as you navigate Gmail (SPA-aware).

### Popup Dashboard

A clean dark-mode popup (380px wide) shows all tracked deadlines bucketed by time:

- **Overdue** (red) · **Today** (amber) · **This Week** (blue) · **Later** (grey) · **No Date**

Each deadline card includes the email subject, sender, category badge, days remaining, and actions: Open Email, Mark Done, Snooze, and Add to Calendar.

---

## Architecture

```
deadline-os/
├── manifest.json                  # MV3 manifest — permissions, OAuth2, scripts
│
├── background/
│   ├── service-worker.js          # Main orchestrator: alarms, message routing, pipeline
│   ├── parser.js                  # NLP parser — extracts deadlines from email text
│   ├── scorer.js                  # Confidence scorer — 0.0 to 1.0, action decision
│   ├── gmail-scanner.js           # Gmail API bulk inbox scanner
│   ├── calendar.js                # Google Calendar API integration
│   ├── notifier.js                # Chrome notifications & alarm-based reminders
│   ├── deduplicator.js            # Fingerprinting to prevent duplicate saves
│   └── storage.js                 # Abstraction over chrome.storage.local
│
├── content/
│   ├── email-extractor.js         # Extracts email data from open Gmail DOM
│   ├── gmail-observer.js          # Watches for new emails opened in Gmail
│   └── badge-injector.js          # Injects deadline badges on inbox rows
│
├── popup/
│   ├── popup.html                 # Extension popup UI (dark-mode dashboard)
│   ├── popup.css                  # Popup styles
│   └── popup.js                   # Popup logic — renders cards, actions, stats
│
├── utils/
│   └── date-utils.js              # Date parsing, normalization, relative date utilities
│
└── assets/
    └── icons/                     # SVG icons (16px, 48px, 128px)
```

### Email Processing Pipeline

```
Gmail Inbox
     │
     ├── DOM path (when email is opened)
     │       content/email-extractor.js  →  MESSAGE: EMAIL_OPENED
     │
     └── API path (background scan every 30 min)
             background/gmail-scanner.js
                       │
                       ▼
            background/parser.js        ← Extracts category, dates, urgency
                       │
                       ▼
            background/scorer.js        ← Assigns confidence score & action
                       │
                       ▼
            background/deduplicator.js  ← Fingerprints email, skips duplicates
                       │
                       ▼
            background/storage.js       ← Persists to chrome.storage.local
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
   background/notifier.js   background/calendar.js
   (schedule alarms)        (create calendar event)
```

---

## Getting Started

### Prerequisites

- Google Chrome (or any Chromium-based browser)
- A Google account with Gmail

### Installation (Developer Mode)

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Mona-Agrawall/deadline-os.git
   cd deadline-os
   ```

2. **Open Chrome Extensions:**
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in the top-right corner)

3. **Load the extension:**
   - Click **"Load unpacked"**
   - Select the `deadline-os/` project folder

4. **Pin it** to your toolbar for quick access.

### First Use

1. Navigate to [Gmail](https://mail.google.com) — content scripts activate automatically.
2. Click the **⏰ Deadline OS** icon in your toolbar.
3. Click **"🔍 Scan"** to trigger your first inbox scan.
4. *(Optional)* Click **"📅 Connect Calendar"** to enable Google Calendar sync.

---

## Configuration

Default settings are defined in `background/storage.js` and can be adjusted to your preference:

| Setting | Default | Description |
|---|---|---|
| `autoSaveThreshold` | `0.72` | Minimum score for automatic deadline saving |
| `confirmThreshold` | `0.55` | Minimum score to prompt for user confirmation |
| `notifyMinutesBefore` | `[1440, 60, 15]` | Reminder times: 24 hr, 1 hr, and 15 min before deadline |
| `calendarEnabled` | `false` | Whether to auto-sync deadlines to Google Calendar |
| `calendarId` | `'primary'` | Target calendar for event creation |

---

## Development Notes

### Scorer Weights

The confidence scorer (`background/scorer.js`) uses a weighted signal system:

| Signal | Weight |
|---|---|
| Strong category keyword match | +2.5 |
| Future date found | +2.0 |
| College domain sender | +2.3 (compound) |
| Deadline keyword in subject | +1.5 |
| Urgency: CRITICAL | +1.5 |
| No date found | −2.0 |
| Marketing domain | −2.5 |
| Newsletter penalty (unsubscribe link) | −3.0 |

### Debugging

Open the service worker's DevTools console via `chrome://extensions/` → "service worker" to see detailed logs:

```
[DeadlineOS SW] Subject : Interview Confirmation - SRM IST
[DeadlineOS SW] Category: INTERVIEW
[DeadlineOS SW] Score   : 0.834 → AUTO_SAVE
[DeadlineOS SW] Deadline: April 10, 2026
```

**Dump full storage state:**

```js
chrome.runtime.sendMessage({ type: 'DEBUG_DUMP' }, console.log)
```

**Clear all stored deadlines:**

```js
chrome.runtime.sendMessage({ type: 'CLEAR_ALL' }, console.log)
```

---

## Roadmap

- [ ] Settings panel in popup (adjust thresholds and notification times)
- [ ] Manual "add deadline" from the popup
- [ ] Export deadlines as `.ics` calendar file
- [ ] Multi-account Gmail support
- [ ] Snooze UI with custom duration picker
- [ ] Firefox port (Manifest V3 compatible)

---

## Tech Stack

| Technology | Role |
|---|---|
| Chrome Extensions API (MV3) | Extension runtime and permissions |
| Gmail REST API | Inbox scanning and email parsing |
| Google Calendar API | Deadline event creation |
| Vanilla JavaScript (ES6+) | Zero-dependency application logic |
| `chrome.alarms` | MV3-compatible background scheduling |
| `chrome.storage.local` | Persistent local storage |

---

## Permissions & Privacy

| Permission | Purpose |
|---|---|
| `storage` | Saves deadlines and settings locally in your browser |
| `identity` | Authenticates with Google (OAuth2) for Gmail and Calendar APIs |
| `notifications` | Shows deadline reminder notifications |
| `alarms` | Schedules background polling and reminder alerts |
| `https://mail.google.com/*` | Runs content scripts to read email data and inject badges |
| `https://www.googleapis.com/*` | Calls Gmail and Google Calendar APIs |

**All data is stored locally** in `chrome.storage.local`. Nothing is sent to any external server — the extension communicates exclusively with Google's own APIs.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Author

**Mona Agrawal**

[GitHub](https://github.com/Mona-Agrawall) · Built with ☕ and a lot of missed deadlines.