---
name: unreads
description: Use when user asks about unread messages, inbox status, what's new, or wants a daily briefing. Triggers on "nepřečtené", "co je nového", "unread", "inbox", "briefing".
---

# Smart Unread Messages Triage

Fetch, categorize, and prioritize unread messages from Slack and Gmail. Present actionable overview with bulk actions for low-priority items.

## Process

1. Fetch Slack and Gmail unreads **in parallel**
2. Categorize each message using rules below
3. Display grouped by priority (highest first)
4. Offer bulk actions for low-priority categories

## Slack Categorization

Fetch: `slack_list_unread_channels` → `slack_get_unread_messages` per channel.

| Priority | Category | Detection | Display |
|----------|----------|-----------|---------|
| 1 | **Direct Messages** | DM channels (is_im) | Full message text |
| 2 | **Mentions** | Message contains `<@U...>` for current user | Full message with context |
| 3 | **Channels** | Everything else | Last 2-3 messages, abbreviated |

## Email Categorization

Fetch: `gmail_list_emails` with `query: "is:unread"` (max 30).

Categorize each email by analyzing **From address**, **Subject**, **To/CC fields**:

| Priority | Category | Detection Rules | Display |
|----------|----------|----------------|---------|
| 1 | **Action Required** | From real person + in TO field + contains question/request; OR from Airtable with "zadost" | Full subject, sender, preview |
| 2 | **Invoices & Receipts** | From `invoice@`, `receipt@`, `billing@`, Anthropic, Stripe; subject contains "receipt", "invoice", "payment" | Subject + amount. Suggest `/licence` |
| 3 | **FYI / Informational** | In CC field; OR from known internal sender with no question; OR Jira/project notifications from real people | Abbreviated subject + sender |
| 4 | **Newsletters** | From `newsletter@`, `digest@`, `noreply@` with marketing/content pattern; Substack, Beehiiv; subject contains "weekly", "digest", "issue #" | Subject only. Offer **bulk mark as read** |
| 5 | **Automated / Noise** | From GitHub, Google Calendar, CI/CD, `notifications@`, `no-reply@` with system pattern | Count by source. Offer **bulk mark as read** |

**Tie-breaking**: When uncertain, prefer higher priority (Action Required > FYI).

## Output Format

```
## Slack (N unread)

### Direct Messages (N)
- **Name** (time): "message preview..."

### Mentions (N)
- **#channel** — @you: "message..." (Author, time)

### Channels (N)
- **#channel** (N msgs) — topic summary
---

## Email (N unread)

### Action Required (N)
- **Sender** — "Subject" (time)

### Invoices & Receipts (N)
- **Sender** — "Subject" — €amount
  → Run `/licence` to process

### FYI (N)
- **Sender** — "Subject" (time)

### Newsletters (N) — [Mark all as read?]
- Subject1, Subject2, ...

### Automated (N) — [Mark all as read?]
- Nx GitHub, Nx Calendar, ...
```

## Post-Display Actions

After showing the overview, ask:
1. **Newsletters**: "Mark N newsletters as read?" → `gmail_mark_as_read` in batch
2. **Automated**: "Mark N automated emails as read?" → `gmail_mark_as_read` in batch
3. **Invoices**: "Process invoices with `/licence`?" → invoke licence skill
