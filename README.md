<div align="center">

# ⏰ Deadline OS

**Your personal deadline operating system for Gmail.**

Deadline OS is a Chrome extension that automatically scans your Gmail inbox, intelligently detects academic and professional deadlines, and keeps you on top of everything — interviews, assignments, fee payments, applications, and more. No more hunting through emails; Deadline OS surfaces what matters, when it matters.

[![Tests](https://github.com/Mona-Agrawall/deadline-os/actions/workflows/test.yml/badge.svg)](https://github.com/Mona-Agrawall/deadline-os/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Vanilla JS](https://img.shields.io/badge/Built%20with-Vanilla%20JS-yellow.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

</div>

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Settings](#settings)
- [Development](#development)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Tech Stack](#tech-stack)
- [Permissions & Privacy](#permissions--privacy)
- [License](#license)
- [Author](#author)

---

## Features

### Smart Gmail Scanning

- **Background polling** every 30 minutes via the Gmail API — keeps your deadlines fresh without any manual effort
- **Real-time detection** the moment you open an email in Gmail
- A **targeted Gmail search** fetches only recent (last 7 days), deadline-related mail — up to **30 messages per scan** with rate-limiting
- A **quick pre-filter** skips marketing senders and junk subjects before any parsing happens
- The same email seen both ways (opened *and* scanned) is **stored only once**

### Intelligent Deadline Detection

A **rule-based parser** finds dates in email subjects and bodies:

| Written as | Understood as |
|---|---|
| `15th March 2027`, `March 15, 2027`, `Fri, 15 Mar` | Absolute dates (with or without weekday / year) |
| `12/03/2027`, `12-03-27`, `12.03.2027` | Numeric dates — **day-first by default**, configurable |
| `2027-03-12` | ISO dates |
| `today`, `tonight`, `tomorrow`, `day after tomorrow` | Relative days |
| `in 3 days`, `in two weeks` | Offsets |
| `Friday`, `this Friday`, `next Friday` | Weekdays (always in the future) |
| `5 PM`, `11:59 p.m.`, `17:30`, `noon`, `midnight` | Times near a date are attached to it |

Dates without a time mean **11:59 PM** that day. A date without a year that is long past (e.g. "Jan 5" read in December) is moved to next year. When an email contains several dates, future dates introduced by deadline wording (`due`, `last date`, `closes`, …) win.

A **confidence scoring engine (0.0 → 1.0)** then weighs multiple signals to decide what to do:

| Score Range | Action | Behavior |
|---|---|---|
| ≥ 0.72 | `auto_save` | Saved immediately and synced to calendar |
| 0.60 – 0.71 | `confirm` | Shown under **Needs Review** for you to confirm |
| < 0.60 | `ignore` | Silently discarded |

Signals factored into the score include category keyword strength, date evidence, urgency level, sender domain trust, subject-line quality, newsletter/spam penalties, and placement-specific boosts. Every score comes with a list of **reasons**, printed in the service worker console.

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

- One-click **Connect** from the popup
- High-confidence deadlines are **automatically synced** as calendar events
- Events that already exist are **linked, never duplicated**
- A **retry queue** handles failed syncs — retries every 10 minutes, up to 5 attempts
- Calendar event links are displayed directly on each deadline card

### Smart Notifications

- Reminders at times **you choose** (default: 1 day, 1 hour and 15 minutes before)
- Reminders within the last hour stay on screen until dismissed
- **"Open Email"** and **"Mark Done"** action buttons directly from notifications
- Overdue deadlines trigger a 🚨 "OVERDUE" notification
- Alarms are **rebuilt on browser restart** and whenever reminder settings change

### Inbox Badges

Colored badges appear next to Gmail inbox rows whose subject matches a tracked deadline:

| Badge Style | Meaning |
|---|---|
| 🔴 Pulsing border | Overdue |
| 🔴 Solid border | Due within a day |
| 🟠 Solid border | Due this week |
| No border | Due later |

### Popup Dashboard

A dark-mode popup shows all tracked deadlines bucketed by time:

- **Overdue** · **Today** · **This Week** · **Later** · **No Date** · **Needs Review**

Each card shows the subject, sender, category, days remaining, and actions: Open Email, Done, Snooze (24 h), and Add to Calendar. The footer shows how many deadlines are tracked, done this week, and upcoming. The ⚙ button opens the settings page.

---

## Architecture

```
deadline-os/
├── manifest.json                  # MV3 manifest — permissions, OAuth2, scripts
│
├── background/                    # Service worker and its modules
│   ├── service-worker.js          # Entry point: loads modules, alarms, message routing
│   ├── email-pipeline.js          # The flow every email goes through
│   ├── gmail-scanner.js           # Inbox scan: search query, pre-filter, scan loop
│   ├── gmail-api.js               # Gmail REST calls and message → email conversion
│   ├── date-parser.js             # Finds dates and times in text
│   ├── parser.js                  # Category, best deadline date, urgency
│   ├── scorer.js                  # Confidence score (0.0 – 1.0) and action decision
│   ├── deduplicator.js            # Fingerprints emails so each is processed once
│   ├── storage.js                 # Deadline reads/writes over chrome.storage.local
│   ├── storage-lock.js            # Runs storage writes one at a time
│   ├── settings.js                # User settings with validation and defaults
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
├── options/                       # Settings page
│
├── utils/                         # Code shared across the extension
│   ├── categories.js              # Category → emoji map
│   └── sender-domains.js          # Trusted, marketing and blocked sender domains
│
├── tests/                         # Automated tests (Node test runner + jsdom)
│   └── helpers/                   # Fake chrome API, fake Gmail server, loaders
│
└── assets/icons/                  # PNG icons (16, 48, 128 px)
```

### Email Processing Pipeline

```
Gmail Inbox
     │
     ├── Opened email (content scripts)
     │       gmail-observer.js + email-extractor.js  →  message: EMAIL_OPENED
     │
     └── Background scan (every 30 min, Gmail API)
             gmail-scanner.js + gmail-api.js  (search query + pre-filter)
                       │
                       ▼
            email-pipeline.js
                       │
            deduplicator.js   ← skip emails already processed
                       │
            parser.js         ← category, dates (date-parser.js), urgency
                       │
            scorer.js         ← confidence score & action
                       │
            storage.js        ← save (rejects the same deadline seen twice)
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
       notifier.js          calendar-sync.js → calendar.js
    (schedule reminders)    (auto_save only)
```

---

## Getting Started

### Prerequisites

- **Google Chrome** (sign-in uses `chrome.identity`, which other Chromium browsers don't fully support)
- A Google account with Gmail

### Installation (Developer Mode)

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Mona-Agrawall/deadline-os.git
   cd deadline-os
   ```

2. Open `chrome://extensions/` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `deadline-os/` folder.
4. **Pin** the extension to your toolbar.

### Connecting Google (your own OAuth client)

Gmail and Calendar access goes through an OAuth client that is tied to one extension ID. The client ID in `manifest.json` belongs to the author's Google Cloud project, so anyone else loading the extension needs their own:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Gmail API** and **Google Calendar API**.
2. Configure the **OAuth consent screen** (External, Testing) and add your Google account as a **test user**.
3. Copy your extension's ID from `chrome://extensions/`.
4. Create an **OAuth client ID** of type **Chrome Extension** with that ID.
5. Put the new client ID in `manifest.json` → `oauth2.client_id`, then reload the extension.

> The extension ID of an unpacked extension depends on the folder path. Keep the folder in one place, or the ID — and the OAuth client — will no longer match.

### First Use

1. Open [Gmail](https://mail.google.com) — the content scripts start automatically.
2. Click the **⏰ Deadline OS** icon in your toolbar.
3. Click **Connect** and allow access to Gmail (read-only) and Calendar.
4. Click **🔍 Scan** to run your first inbox scan.
5. Click **⚙** to adjust the settings.

---

## Settings

Open the settings page from the popup's ⚙ button or via `chrome://extensions` → Deadline OS → *Extension options*.

| Setting | Default | Effect |
|---|---|---|
| Date format | Day first (`DD/MM/YYYY`) | How ambiguous numeric dates like `03/04/2027` are read |
| Reminders | 1 day, 1 hour, 15 minutes | When notifications fire; existing reminders are rebuilt on save |
| College / university domains | `srmist.edu.in`, … | Most trusted senders; always scanned |
| Career & recruiting domains | `haveloc.com`, `hackerrank.com`, … | Trusted placement senders; always scanned |

Other tunable values are constants at the top of their module:

| What | Where |
|---|---|
| Score thresholds and signal weights | `ACTION_THRESHOLDS`, `WEIGHTS` in `background/scorer.js` |
| Scan size and search keywords | `MAX_RESULTS`, `SEARCH_KEYWORDS` in `background/gmail-scanner.js` |
| Polling / cleanup / retry intervals | `setupAlarms()` in `background/service-worker.js` |
| Marketing and blocked senders | `utils/sender-domains.js` |

### Scorer Weights

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

---

## Development

The extension itself has no build step and no runtime dependencies. Node.js (20+) is only needed for the tests.

```bash
npm install     # installs jsdom for the page tests
npm test        # runs every tests/*.test.js with Node's built-in test runner
```

The tests load the extension's **real source files** — exactly as Chrome runs them — into a sandbox with a fake `chrome` API and fake Gmail/Calendar servers. The popup, the settings page and the Gmail content scripts run in jsdom. GitHub Actions runs the suite on every push.

| Test file | Covers |
|---|---|
| `date-parser.test.js` | Every date/time format, date order, year rollover, false positives |
| `parser.test.js`, `scorer.test.js` | Categories, urgency, best-date choice, scores and actions |
| `settings.test.js`, `storage.test.js`, `deduplicator.test.js` | Validation, persistence, duplicates, concurrent writes |
| `notifier.test.js`, `calendar.test.js` | Reminders, notifications, calendar events, retries, token refresh |
| `gmail-scanner.test.js`, `service-worker.test.js` | Full scans and every message the service worker answers |
| `popup.test.js`, `options.test.js`, `content-scripts.test.js` | UI behaviour, Gmail badges and email detection |

### Debugging

Open the service worker's console via `chrome://extensions/` → Deadline OS → **service worker**. Every processed email is logged with its category, score, action, and the reasons behind the score:

```
[Pipeline] "Interview Confirmation - SRM IST" → INTERVIEW (0.834) → auto_save ['Strong category match: INTERVIEW (interview)', ...]
```

```js
chrome.storage.local.get(null, console.log)   // dump all stored data
chrome.storage.local.clear()                  // reset everything
```

---

## Known Limitations

- **Gmail page markup.** Reading an opened email relies on Gmail's CSS class names, which Google can change. Each field has fallback selectors, and the background Gmail API scan does not depend on the page at all.
- **Publishing.** `gmail.readonly` is a restricted Google scope. Publishing on the Chrome Web Store requires Google's OAuth verification; until then, only test users added to the OAuth consent screen can sign in.
- **Rule-based detection.** Unusual wording can be missed or misread. Low-confidence results go to *Needs Review* instead of being saved silently.

---

## Roadmap

- [x] Settings page (date format, reminder times, trusted domains)
- [ ] Manual "add deadline" from the popup
- [ ] Export deadlines as an `.ics` calendar file
- [ ] Custom snooze durations
- [ ] Firefox port

---

## Tech Stack

| Technology | Role |
|---|---|
| Chrome Extensions API (MV3) | Extension runtime and permissions |
| Gmail REST API | Inbox scanning |
| Google Calendar API | Deadline event creation |
| Vanilla JavaScript (ES2020+) | Zero-dependency application logic |
| `chrome.alarms` / `chrome.storage.local` | Background scheduling and local persistence |
| Node.js test runner + jsdom | Automated tests |
| GitHub Actions | Continuous integration |

---

## Permissions & Privacy

| Permission | Purpose |
|---|---|
| `storage` | Saves deadlines and settings locally in your browser |
| `identity` | Signs in with Google (OAuth2) for the Gmail and Calendar APIs |
| `notifications` | Shows deadline reminder notifications |
| `alarms` | Schedules background scans and reminders |
| `https://mail.google.com/*` | Runs content scripts to read opened emails and show badges |
| `https://www.googleapis.com/*` | Calls the Gmail and Google Calendar APIs |

**All data is stored locally** in `chrome.storage.local`. Nothing is sent to any external server — the extension talks only to Google's own APIs, with read-only access to Gmail.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Author

**Mona Agrawal**

[GitHub](https://github.com/Mona-Agrawall) · Built with ☕ and a lot of missed deadlines.
