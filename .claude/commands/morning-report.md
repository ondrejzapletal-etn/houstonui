---
name: morning-report
description: "Generate and send a morning briefing (Gmail + Calendar + Slack) as a Slack DM. Use when user says 'morning report', 'ranní report', 'co mě čeká', 'briefing', or invokes /morning-report."
---

# Morning Report

Generate a daily morning briefing and send it as Slack DM to the current user.

## Step 0: Detect current user and load config

1. Call `slack_whoami` to get the current user's Slack ID, name, and email.
2. Look for a local config file at `~/.houston/morning-report.yaml`.
   - If it exists, read it and use the `channels` list from it.
   - If it does NOT exist, use the fallback strategy: `slack_list_unread_channels` and take the top 10 channels by unread count.

### Config format

```yaml
# ~/.houston/morning-report.yaml
# Customize which Slack channels appear in your morning report.
channels:
  - name: general
    description: company general channel
  - name: engineering
    description: engineering team
  # Add your team/project channels:
  # - name: team-your-team
  #   description: your team channel
```

## Step 1: Fetch data (in parallel where possible)

**Calendar:**
- Use `calendar_get_today_agenda` to get all events for today
- IMPORTANT: Filter results to only include events where `calendar_id` matches the current user's email (from Step 0). Discard events from shared/colleague calendars to reduce noise.

**Gmail (reuse /unreads categorization):**
- Use `gmail_list_emails` with `query: "is:unread"` (max 30)
- Categorize each email using the same 5-priority system as `/unreads`:

| Priority | Category | Detection Rules |
|----------|----------|----------------|
| 1 | **Action Required** | From real person + in TO field + contains question/request |
| 2 | **Invoices & Receipts** | From `invoice@`, `receipt@`, `billing@`; subject contains "receipt", "invoice", "payment" |
| 3 | **FYI / Informational** | In CC field; OR internal sender with no question; OR Jira/project notifications from real people |
| 4 | **Newsletters** | From `newsletter@`, `digest@`, `noreply@` with marketing pattern; Substack, Beehiiv |
| 5 | **Automated / Noise** | GitHub, Google Calendar, CI/CD, `notifications@`, `no-reply@` with system pattern |

- In the morning report, only include Priority 1-3 emails. Show Priority 4-5 as counts only (e.g., "4 newsletters, 12 automated — use /unreads to triage").

**Slack:**
1. Use `slack_list_unread_channels` to find ALL channels with unread activity
2. If user has a config file: use `slack_read_messages` (limit=50) for each configured channel regardless of unread status
3. If no config file: take top 10 channels by unread count from step 1 and use `slack_get_unread_messages` for each
4. For remaining channels with unreads (not in config / not in top 10), list them as "other channels with activity"
5. Scan ALL fetched messages for direct @mentions of the current user (by Slack ID from Step 0) — tag these as highlights

## Step 2: Format and show report

Compose the report in the CLI first. Use the current user's name and today's date.

**Template (Slack mrkdwn formatting):**

```
Tady je tvuj ranni briefing:

CALENDAR — TODAY (day date)
- time - Event name (location/online)
-> Free slots: ...

EMAIL (N require attention)
Action Required:
- Sender — Subject
  short snippet...
FYI:
- Sender — Subject
(N newsletters, M automated — /unreads to triage)

SLACK — HIGHLIGHTS
Mentions of you:
- #channel — who: what <- @you
- #channel — who: context

SLACK — CHANNEL SUMMARIES

#channel-name (N messages)
Summary of main topics...

Other channels with activity:
- #channel: N new — short preview

[AI disclaimer from CLAUDE.md]
```

**Show the composed report to the user in the CLI and ask for confirmation before sending.** This follows the CLAUDE.md messaging policy: propose first, send after approval.

## Step 3: Send

After user confirms, send the report as Slack DM to the current user via `slack_post_message`.

If the message exceeds the 4000 char Slack limit, split into multiple messages:
1. First message: Calendar + Email + Highlights
2. Second message: Channel summaries (part 1)
3. Third message: Channel summaries (part 2) if needed

## Rules

- Every message MUST end with the AI disclaimer from `~/.houston/profile.yaml` (default: `[AI 🐏]`)
- No greetings (no "Good morning", "Ahoj") — start directly with content per Slack style conventions
- Use Slack mrkdwn formatting (*bold*, _italic_)
- Keep it scannable — bullet points, no walls of text
- Channel summaries: max 2-3 sentences per channel, focus on decisions, action items, important info
- Highlights (mentions of the user) go FIRST, before channel summaries
- If a data source fails, show a warning but still send the rest
- Use the language matching the user's CLAUDE.md / workspace conventions
- Skip channels that had zero relevant activity

## First-time setup

When a user runs `/morning-report` for the first time and has no `~/.houston/morning-report.yaml`:

1. Run the report using top 10 unread channels as fallback
2. After sending, tell the user:
   ```
   Tip: Create ~/.houston/morning-report.yaml to customize which channels
   are always included (even when they have no unreads). Example:

   channels:
     - name: general
       description: company general channel
     - name: etng-ai
       description: AI initiatives
     - name: team-epk
       description: my team channel
   ```

## Automatic scheduling (optional)

To receive the report automatically every workday morning, set up a cron job or launchd:

**macOS (launchd) — recommended:**
Create `~/Library/LaunchAgents/com.houston.morning-report.plist` — runs at 7:30 on weekdays:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.houston.morning-report</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/claude</string>
        <string>-p</string>
        <string>/morning-report</string>
        <string>--allowedTools</string>
        <string>mcp__houston-*</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
        <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
        <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
        <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
        <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
    </array>
</dict>
</plist>
```
Then: `launchctl load ~/Library/LaunchAgents/com.houston.morning-report.plist`

**Linux/macOS (cron):**
```
30 7 * * 1-5 /usr/local/bin/claude -p "/morning-report" --allowedTools "mcp__houston-*"
```
