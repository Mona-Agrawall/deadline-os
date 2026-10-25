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
- [Tuning](#tuning)
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
- A **targeted Gmail search** fetches only recent (last 7 days), deadline-related mail — up to **30 messages per scan** with rate-limiting
- A **quick pre-filter** skips marketing senders and junk subjects before any parsing happens

### Intelligent Deadline Detection

A **rule-based NLP parser** extracts deadline signals from email subjects and bodies, supporting:

- Diverse date formats: `April 5`, `05/04/2026`, `in 3 days`, `next Friday`, `tomorrow`
- Relative time expressions, ISO dates, and contextual patterns (`due by`, `submit before`, `closes on`)

A **confidence scoring engine (0.0 → 1.0)** then weighs multiple signals to decide what to do:

| Score Range | Action | Behavior |
|---|---|---|
| ≥ 0.72 | `auto_save` | Saved immediately and synced to calendar |
| 0.60 – 0.71 | `confirm` | Shown under **Needs Review** for you to confirm |
| < 0.60 | `ignore` | Silently discarded |

Signals factored into the score include category keyword strength, date evidence, urgency level, sender domain trust, subject-line quality, newsletter/spam penalties, and placement-specific boosts.

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

Each deadline card includes the email subject, sender, category badge, days remaining, and actions: Open Email, Mark Done, Snooze, and Add to Calendar. Low-confidence deadlines appear in a separate **Needs Review** section, and the footer shows how many deadlines are tracked, done this week, and upcoming.

---

## Architecture

```
deadline-os/
├── manifest.json                  # MV3 manifest — permissions, OAuth2, scripts
│
├── background/                    # Service worker and its modules
│   ├── service-worker.js          # Entry point: loads modules, alarms, message routing
│   ├── email-pipeline.js          # The flow every email goes through (dedupe → parse → score → save)
│   ├── gmail-scanner.js           # Gmail API inbox scanner
│   ├── parser.js                  # Rule-based parser — category, dates, urgency
│   ├── scorer.js                  # Confidence score (0.0 – 1.0) and action decision
│   ├── deduplicator.js            # Fingerprinting to prevent duplicate saves
│   ├── storage.js                 # Deadline reads/writes over chrome.storage.local
│   ├── notifier.js                # Alarm-based reminders and notifications
│   ├── auth.js                    # Google sign-in and authorized API requests
│   ├── calendar.js                # Google Calendar event creation
│   └── calendar-sync.js           # Syncs deadlines to Calendar, with a retry queue
│
├── content/                       # Scripts that run inside Gmail
│   ├── email-extractor.js         # Reads the open email from the Gmail page
│   ├── gmail-observer.js          # Detects when an email is opened
│   └── badge-injector.js          # Adds deadline badges to inbox rows
│
├── popup/                         # Toolbar popup dashboard
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
│
├── utils/                         # Code shared across the extension
│   ├── categories.js              # Category → emoji map
│   ├── date-utils.js              # Date text → Date parsing
│   └── sender-domains.js          # Trusted, marketing and blocked sender domains
│
└── assets/
    └── icons/                     # SVG icons (16px, 48px, 128px)
```

### Email Processing Pipeline

```
Gmail Inbox
     │
     ├── DOM path (when an email is opened)
     │       content/gmail-observer.js + email-extractor.js  →  message: EMAIL_OPENED
     │
     └── API path (background scan every 30 min)
             background/gmail-scanner.js  (search query + pre-filter)
                       │
                       ▼
            background/email-pipeline.js
                       │
                       ▼
            background/deduplicator.js  ← Fingerprints email, skips duplicates
                       │
                       ▼
            background/parser.js        ← Extracts category, dates, urgency
                       │
                       ▼
            background/scorer.js        ← Assigns confidence score & action
                       │
                       ▼
            background/storage.js       ← Persists to chrome.storage.local
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
   background/notifier.js   background/calendar-sync.js
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

## Tuning

All tunable values are constants at the top of their module:

| What | Where | Default |
|---|---|---|
| Score thresholds (`auto_save` / `confirm`) | `ACTION_THRESHOLDS` in `background/scorer.js` | `0.72` / `0.60` |
| Signal weights | `WEIGHTS` in `background/scorer.js` | see below |
| Reminder times | `REMINDER_MINUTES` in `background/notifier.js` | `[1440, 60, 15]` |
| Scan size and search keywords | `MAX_RESULTS`, `SEARCH_KEYWORDS` in `background/gmail-scanner.js` | `30` |
| Polling / cleanup / retry intervals | `setupAlarms()` in `background/service-worker.js` | 30 min / 1 day / 10 min |
| Trusted, marketing and blocked senders | `utils/sender-domains.js` | — |

---

## Development Notes

### Scorer Weights

The confidence scorer (`background/scorer.js`) uses a weighted signal system:

| Signal | Weight |
|---|---|
| Strong category keyword match | +3.0 |
| Haveloc email | +2.5 |
| College domain sender | +2.3 |
| Future date found | +2.0 |
| Career platform sender | +1.85 |
| Deadline keyword in subject | +1.5 |
| Placement signal in subject | +1.5 |
| Urgency: CRITICAL | +1.5 |
| Automated / no-reply sender | −1.5 |
| No date found | −2.5 |
| Engagement bait | −2.5 |
| Promotional subject | −3.0 |
| Marketing domain | −3.5 |
| Newsletter penalty (unsubscribe link) | −4.0 |

The raw total is divided by 11 and clamped to 0 – 1.

### Debugging

Open the service worker's DevTools console via `chrome://extensions/` → "service worker". Every processed email is logged with its category, score, action, and the signals that produced the score:

```
[Pipeline] "Interview Confirmation - SRM IST" → INTERVIEW (0.834) → auto_save ['Strong category match: INTERVIEW (interview)', ...]
```

**Dump full storage state** (in the service worker console):

```js
chrome.storage.local.get(null, console.log)
```

**Clear all stored data:**

```js
chrome.storage.local.clear()
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
