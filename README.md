# ⏰ Deadline OS

> **Your personal deadline operating system for Gmail.**

Deadline OS is a Chrome extension that automatically scans your Gmail inbox, intelligently detects academic and professional deadlines, and keeps you on top of everything — interviews, assignments, fee payments, applications, and more. No more hunting through emails; Deadline OS surfaces what matters, when it matters.

---

## ✨ Features

### 🔍 Smart Gmail Scanning
- **Background polling** every 30 minutes using the Gmail API — keeps your deadlines fresh without manual effort
- **DOM-based real-time detection** triggers the moment you open an email in Gmail
- Processes up to **50 inbox messages per scan** with automatic rate-limiting

### 🧠 Intelligent Deadline Detection
- **Rule-based NLP parser** extracts deadline signals from email subject and body:
  - Diverse date formats: `April 5`, `05/04/2026`, `in 3 days`, `next Friday`, `tomorrow`
  - Relative time expressions, ISO dates, and contextual patterns ("due by", "submit before", "closes on")
- **Confidence scoring engine (0.0 → 1.0)** weighs multiple signals:
  - Category keyword strength (strong vs. weak matches)
  - Date evidence (future dates scored higher)
  - Urgency signals (`CRITICAL`, `HIGH`, `MEDIUM`, `NORMAL`, `LOW`)
  - Sender domain trust (college domains, career platforms vs. personal Gmail)
  - Subject-line quality (action words, deadline keywords)
  - Newsletter / spam penalty (unsubscribe links, marketing domains)
- **Three-tier action system** based on score:
  | Score | Action | Behavior |
  |-------|--------|----------|
  | ≥ 0.72 | `auto_save` | Saved immediately, synced to calendar |
  | 0.55 – 0.71 | `confirm` | Shown with a ⚠️ confirm prompt |
  | < 0.55 | `ignore` | Silently discarded |

### 📂 Deadline Categories
| Category | Examples |
|----------|----------|
| 🎯 **Interview** | Interview confirmation, HireVue, phone screen, technical round |
| 📝 **Assignment** | Homework due, project deadline, CIA exam, viva, lab submission |
| 💳 **Payment** | Fee due, hostel dues, exam fee, mess fee, EMI |
| 📋 **Application** | Apply by, registration deadline, placement drive, PPO |
| 📅 **Event** | Webinar, seminar, hackathon, orientation, workshop |
| 🔔 **Reminder** | Gentle reminder, action required, urgent notices |

### 📅 Google Calendar Integration
- One-click **Connect Calendar** from the popup
- High-confidence deadlines (`auto_save`) are **automatically synced** as calendar events
- **Retry queue** handles failed syncs — retries every 10 minutes, up to 5 attempts
- Calendar link displayed on every synced deadline card

### 🔔 Smart Notifications
- **Three-tier reminder system**: 24 hours, 1 hour, and 15 minutes before each deadline
- Notifications persist on-screen for the 1-hour and 15-minute reminders
- Supports **"Open Email"** and **"Mark Done"** buttons directly from notifications
- Overdue deadlines trigger a 🚨 "OVERDUE" notification
- Alarms are **rescheduled on browser restart** to survive MV3 service worker termination

### 🏷️ Inbox Badge Injection
- Injects **colored emoji badges** next to matching Gmail inbox rows
- Badges visually indicate category and urgency:
  - 🔴 Pulsing border = Overdue
  - 🟠 Solid border = Due today
  - 🟡 Solid border = Due this week
  - No border = Later
- Automatically updates via a **MutationObserver** as you navigate Gmail (SPA-aware)

### 🪟 Popup Dashboard
A clean dark-mode popup (380px wide) shows all tracked deadlines bucketed by time:
- **Overdue** (red)
- **Today** (amber)
- **This Week** (blue)
- **Later** (grey)
- **No Date** (for deadline-confirmed emails without a parseable date)

Each deadline card includes:
- Email subject, sender, category badge, days until deadline
- "Open Email", "Mark Done", "Snooze", and "Add to Calendar" actions
- Calendar sync status (🟢 linked to calendar event)

---

## 🏗️ Architecture

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
     ├─── DOM path (when email is opened)
     │         content/email-extractor.js  →  MESSAGE: EMAIL_OPENED
     │
     └─── API path (background scan every 30 min)
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

## 🚀 Getting Started

### Prerequisites
- Google Chrome (or any Chromium-based browser)
- A Google account with Gmail

### Installation (Developer Mode)

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/Mona-Agrawall/deadline-os.git
   cd deadline-os
   ```

2. **Open Chrome Extensions**:
   - Go to `chrome://extensions/`
   - Enable **Developer mode** (toggle in the top-right)

3. **Load the extension**:
   - Click **"Load unpacked"**
   - Select the `deadline-os/` project folder

4. **Pin it** to your toolbar for easy access.

### First Use

1. Navigate to [Gmail](https://mail.google.com) — the content scripts will activate automatically.
2. Click the **⏰ Deadline OS** icon in your toolbar.
3. Click **"🔍 Scan"** to trigger your first inbox scan.
4. (Optional) Click **"📅 Connect Calendar"** to enable Google Calendar sync.

---

## 🔐 Permissions & Privacy

| Permission | Why it's needed |
|------------|-----------------|
| `storage` | Saves deadlines and settings locally in your browser |
| `identity` | Authenticates with Google (OAuth2) for Gmail and Calendar APIs |
| `notifications` | Shows deadline reminder notifications |
| `alarms` | Schedules background polling and reminder alerts |
| `https://mail.google.com/*` | Runs content scripts to read email data and inject badges |
| `https://www.googleapis.com/*` | Calls Gmail and Google Calendar APIs |

**All data is stored locally** in `chrome.storage.local` — nothing is sent to any external server. The extension communicates only with Google's own APIs.

---

## ⚙️ Configuration

Default settings (editable in `background/storage.js`):

| Setting | Default | Description |
|---------|---------|-------------|
| `autoSaveThreshold` | `0.72` | Score above which deadlines are auto-saved |
| `confirmThreshold` | `0.55` | Score above which deadlines need confirmation |
| `notifyMinutesBefore` | `[1440, 60, 15]` | Reminder times: 24hr, 1hr, 15min before deadline |
| `calendarEnabled` | `false` | Whether to auto-sync to Google Calendar |
| `calendarId` | `'primary'` | Which calendar to create events in |

---

## 🧪 Development Notes

### Scorer Weights
The confidence scorer (`background/scorer.js`) uses a weighted signal system. Key signals:

| Signal | Weight |
|--------|--------|
| Strong category match | +2.5 |
| Future date found | +2.0 |
| Deadline keyword in subject | +1.5 |
| Urgency: CRITICAL | +1.5 |
| College domain sender | +2.3 (compound) |
| Newsletter penalty (unsubscribe) | **-3.0** |
| Marketing domain | **-2.5** |
| No date found | **-2.0** |

### Debugging
Open the service worker's DevTools console (`chrome://extensions/` → "service worker" link) to see detailed logs:

```
[DeadlineOS SW] Subject : Interview Confirmation - SRM IST
[DeadlineOS SW] Category: INTERVIEW
[DeadlineOS SW] Score   : 0.834 → AUTO_SAVE
[DeadlineOS SW] Deadline: April 10, 2026
```

To dump full storage state, run in the service worker console:
```js
chrome.runtime.sendMessage({ type: 'DEBUG_DUMP' }, console.log)
```

To clear all stored deadlines:
```js
chrome.runtime.sendMessage({ type: 'CLEAR_ALL' }, console.log)
```

---

## 🗺️ Roadmap

- [ ] Settings panel in popup (adjust thresholds, notification times)
- [ ] Manual "add deadline" from popup
- [ ] Export deadlines as `.ics` calendar file
- [ ] Multi-account Gmail support
- [ ] Snooze UI with custom duration picker
- [ ] Firefox port (Manifest V3 compatible)

---

## 🛠️ Tech Stack

- **Chrome Extensions API** — Manifest V3
- **Gmail REST API** — inbox scanning & email parsing
- **Google Calendar API** — deadline event creation
- **Vanilla JavaScript** — zero dependencies, pure ES6+
- **chrome.alarms** — MV3-compatible background scheduling
- **chrome.storage.local** — persistent local storage

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 👤 Author

**Mona Agrawal**  
[GitHub](https://github.com/Mona-Agrawall) · Built with ☕ and a lot of missed deadlines.
