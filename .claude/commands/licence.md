---
name: licence
description: Use when managing Claude.ai organization licenses, processing access requests from Airtable or Slack, upgrading seat tiers, or matching Anthropic invoices with Fidoo expenses. Triggers on "licence", "přístupy", "faktury Anthropic", "seat upgrade".
---

# Claude.ai License Management

Perform a complete audit and resolve all pending Claude.ai license requests and invoices.

**Before starting:** Read `~/.houston/profile.yaml` for `claude_org` (organization name) and `employee_directory_url` (URL to verify affiliation). If these are empty, ask the user to configure them.

## 1. SCAN - discover what needs to be done

Run in parallel:

### New access requests
- **Gmail**: Search `from:airtable subject:"Nova zadost o SW"` - unprocessed requests (last week or unread)
- **Slack**: Check unread messages (`slack_list_unread_channels` + `slack_get_unread_messages`) - look for requests for Claude access or higher limits
- **claude.ai admin**: Open `https://claude.ai/admin-settings/organization` in browser and check admin notifications (button in header) for pending requests

### Invoices to process
- **Gmail**: Search `from:invoice+statements@mail.anthropic.com subject:"Your receipt from Anthropic"` - unread/recent receipts. Each receipt contains amount in EUR, invoice number and Stripe "Download invoice" link to PDF. May also have PDF attachment.
- **Fidoo**: Open `https://www.fidoo.com/app/my-finance/expenses/expenses` (My Finance → Expenses) and check expenses in "Open" status (missing receipt/cost center)

Extract from each request: **name, email, requested software**.

## 2. PLAN - show overview

Display what was found:
```
Found:
- X new access requests (names)
- X invoices to process (amounts)
- X pending requests on claude.ai
- X unmatched expenses in Fidoo
Proceeding with execution.
```

## 3. EXECUTE - resolve everything step by step

### Workflow 1: Add member (for each request)

1. **GUARDRAIL - verify affiliation**: Open the `employee_directory_url` from profile.yaml, find the requester and verify they belong to the configured `claude_org`. If they belong to a different company, SKIP and inform the user.

2. **Add on claude.ai**:
   - **Switch organization**: Must be switched to the configured `claude_org` (not Personal/Max plan). Click profile at bottom of sidebar → select the organization / Team plan. You can tell by the organization name visible at the bottom of the sidebar.
   - Open `https://claude.ai/admin-settings/organization`
   - Click "Add member"
   - Enter requester's email
   - Role: User, Tier: Standard (unless user specified otherwise)
   - Click "Add member" and confirm payment dialog (check checkbox + "Confirm & purchase")

3. **Airtable update** (only if request came from Airtable email):
   - Open the Airtable record link from the email
   - Find the status column (select dropdown)
   - Change to "Done"

### Workflow 2: Upgrade tier (when someone requests a higher limit)

1. **Switch organization** (see Workflow 1 step 2) - must be on the configured organization
2. Open `https://claude.ai/admin-settings/organization`
3. Use Search box to find the member by name/email
4. Click their Seat Tier dropdown button (showing "Standard")
5. Select "Premium seat"
6. In the "Upgrade 1 seat to Premium?" dialog click "Next"
7. In the "Confirm changes" payment dialog: check the confirmation checkbox and click "Confirm & purchase"
8. Reply to the requester on Slack that the upgrade was completed

### Workflow 3a: Team account invoice (email with PDF)

1. Find unread receipt emails from `invoice+statements@mail.anthropic.com` with subject "Your receipt from Anthropic, PBC #..."
2. From the email body, get the amount in EUR and invoice number. Email also contains a Stripe "Download invoice" link to PDF.
3. Download the PDF attachment using `gmail_download_attachment` to `~/Downloads/`
4. Open Fidoo in browser (requires login - if not logged in, ask the user):
   - Navigate to **My Finance → Expenses** (`https://www.fidoo.com/app/my-finance/expenses/expenses`)
   - WARNING: Do NOT go to "Tasks" (`/app/inbox/tasks`) - the correct section is Expenses!
5. Find the matching expense by **amount in EUR** (e.g. "ANTHROPIC CLAUDE TEAM SAN FRANCISCO USA")
6. Open expense detail and click the **"Uctenky"** (Receipts) tab
7. Upload PDF via **"Nahrat uctenku"** (Upload receipt) - it's a hidden file input `#d-file-upload-0`. To upload:
   - Start a temporary HTTP server: `python3 -c "import http.server; ..." &` on port 8765 in ~/Downloads/
   - Via JavaScript fetch the PDF from localhost, create a File object via DataTransfer API and set it on the input
8. Click **"Upravit"** (Edit) and select **cost center** based on the user's team:
   - Find the user at the `employee_directory_url` from profile - their detail page shows their team
   - Team maps to cost center in Fidoo (e.g. Fusion → FUSION)
9. Click **"Ulozit a odeslat ke schvaleni"** (Save and submit for approval) - NOT just "Save"!
10. Mark the processed receipt email as read (`gmail_mark_as_read`)
11. If the expense doesn't exist in Fidoo yet - the card payment hasn't been processed, inform the user

### Workflow 3b: API account invoice (no email)

1. Open `https://platform.claude.com/settings/billing`
2. Find the correct invoice by amount/period
3. Download PDF
4. Open Fidoo: **My Finance → Expenses** (`https://www.fidoo.com/app/my-finance/expenses/expenses`)
5. Find the matching expense by **amount in EUR**
6. Upload PDF and select cost center (for API account, agree on cost center with the user)
7. Click **"Ulozit a odeslat ke schvaleni"** (Save and submit for approval)

## 4. REPORT - summary

Display a clear summary of what was done:
- Who was added (name, email, tier)
- Who was upgraded (name, from what to what)
- Which invoices were matched (amount, payment)
- What failed and why

## Important guardrails

- **Configured organization only** - never add people from other companies in the group
- **When uncertain, STOP** - ask the user for a decision, never guess
- **Airtable only after successful addition** - set status to Done only after the license is actually granted
- Use browser automation (mcp__claude-in-chrome__*) for all web actions
- Use Houston Gmail MCP for email operations
