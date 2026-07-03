# Codex Handoff

This document is for continuing development of this project outside Cursor.

## Project Summary

This is a lightweight accounting web app built with React, Vite, TypeScript, and Tencent CloudBase.

Main capabilities:

- Email sign-up/sign-in through CloudBase Auth.
- Cloud-synced income and expense transactions.
- Daily, monthly, and yearly transaction views.
- Budget tracking with daily and monthly progress.
- Receipt image parsing through TokenHub.
- Chat-style AI accounting assistant, including text/voice input and transaction draft confirmation.
- AI-assisted category fallback and monthly spending reports.
- Extra tools: recurring transactions, stored-value cards, personal assets, lie-flat calculator, category management.

## Repository

Project root:

```bash
/Users/charlie/Desktop/charlie/accounting-app
```

Important app folders:

- `src/pages/`: route pages.
- `src/context/AccountingContext.tsx`: central accounting state, CloudBase reads/writes, budgets, categories, recurring behavior.
- `src/lib/`: CloudBase and TokenHub client helpers.
- `src/accounting/`: accounting constants, category rules, budget math, formatting.
- `cloudfunctions/`: Tencent CloudBase cloud functions.

## Environment

The app needs this frontend environment variable:

```env
VITE_TCB_ENV_ID=test-d3g2xaivpb160ef4f
```

Use:

```bash
cp .env.example .env.local
```

Do not commit `.env.local`.

Cloud function secrets are configured in Tencent CloudBase console, not in the repo:

- `TOKENHUB_API_KEY`
- Optional `TOKENHUB_MODEL`
- Optional `TOKENHUB_BASE_URL`

If `TOKENHUB_MODEL` is omitted, code defaults are used.

## Commands

Install dependencies:

```bash
npm install
```

Local development:

```bash
npm run dev
```

Default local URL:

```text
http://127.0.0.1:5173/
```

Check before shipping:

```bash
npm run check
```

Build only:

```bash
npm run build
```

Deploy frontend to CloudBase Hosting:

```bash
npm run deploy:tcb
```

Deploy cloud functions:

```bash
npm run deploy:fn-receipt
npm run deploy:fn-voice
npm run deploy:fn-classify
npm run deploy:fn-report
```

First-time CloudBase CLI login:

```bash
npx -p @cloudbase/cli@latest tcb login
```

## Tencent Cloud Resources

CloudBase environment ID:

```text
test-d3g2xaivpb160ef4f
```

Current CloudBase Hosting URL:

```text
https://test-d3g2xaivpb160ef4f-1323111038.tcloudbaseapp.com
```

Custom domain being prepared:

```text
ccjizhang.cn
```

Current custom-domain status:

- HTTPS certificate has been requested/associated.
- Binding is blocked by ICP filing requirement.
- Tencent Cloud error seen: `InvalidParameter.HTTPServiceDomainNotICP`.
- The domain needs ICP filing before it can be bound to Tencent Cloud domestic CloudBase Hosting.

## Cloud Functions

`parseReceiptTokenhub`

- Used for receipt image parsing.
- Default model: `youtu-vita`.
- Requires `TOKENHUB_API_KEY`.

`parseVoiceTransactionTokenhub`

- Used for voice/text transaction parsing and chat accounting.
- Default model: `deepseek-v4-flash`.
- Also powers "小猪查理", the chat-style life assistant with accounting abilities.
- Requires `TOKENHUB_API_KEY`.

`classifyTransactionsTokenhub`

- Used as AI category fallback after local rules.
- Default model: `deepseek-v4-flash`.
- Requires `TOKENHUB_API_KEY`.

`generateSpendingReportTokenhub`

- Used for natural-language spending reports.
- Default model: `deepseek-v4-flash`.
- Requires `TOKENHUB_API_KEY`.

TokenHub endpoint default:

```text
https://tokenhub.tencentmaas.com/v1
```

## Database Collections

Expected CloudBase collections:

- `transactions`
- `budgets`
- `recurring_templates`
- `user_category_lists`
- `monthly_ai_reports`
- `personal_assets`
- `stored_value_cards`
- `stored_value_card_records`

Security rule expectation:

- Records are user-scoped with `user_id`.
- Users should only read/write their own documents.

## Recent Important Changes

Homepage budget card:

- Fixed daily budget display when the monthly budget is already exceeded.
- Daily section now still shows current-period spending.
- If daily available budget is `<= 0`, daily progress is treated as over-budget and rendered as a red full bar.
- The red daily bar currently uses inline background fallback in `src/pages/LedgerPage.tsx` to avoid CSS class mismatch or stale style issues.

AI model migration:

- Replaced older default text model `deepseek-v3.1-terminus` with `deepseek-v4-flash`.
- Re-deployed these functions after the change:
  - `parseVoiceTransactionTokenhub`
  - `classifyTransactionsTokenhub`
  - `generateSpendingReportTokenhub`

Chat assistant behavior:

- "小猪查理" is no longer only a bookkeeping bot.
- It is positioned as a life assistant with accounting abilities.
- It can chat about daily life, learning, planning, emotions, shopping choices, writing ideas, cooking, travel, and consumption advice.
- It should not force every casual chat back to accounting.

## Product Notes

The app currently uses Tencent CloudBase default domain in production. This can show Tencent-side "developer reminder" prompts in some situations. The intended fix is to bind `ccjizhang.cn`, but Tencent Cloud requires ICP filing first.

For iPhone users:

- Microphone permission behavior may be affected by browser/PWA context.
- HTTPS is required for stable microphone and PWA behavior.

## Safety Notes

Do not commit:

- `.env.local`
- TokenHub API keys
- Tencent Cloud credentials
- Any exported user transaction data

Be careful when changing:

- `AccountingContext.tsx`, because it owns most persistence and shared app behavior.
- Cloud function prompts, because frontend fallback behavior depends on returned JSON shape.
- Budget math, because homepage budget display and budget page summaries should remain consistent.

## Suggested Handoff Prompt For Codex

```text
You are taking over a React + Vite + TypeScript accounting web app deployed on Tencent CloudBase.

Read HANDOFF.md and README.md first. The project root is accounting-app.

Use existing patterns. Do not commit secrets. Run npm run check before suggesting deployment. CloudBase environment is test-d3g2xaivpb160ef4f. TokenHub keys live only in CloudBase cloud function environment variables.

Current focus: continue product development and maintenance for the accounting app. Recent work fixed the homepage budget card over-budget daily progress display and expanded the chat assistant into a broader life assistant.
```
