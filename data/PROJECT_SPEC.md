# Project: agentic earn-to-spend platform (Monad + Rain)

## One-line pitch
Users pay small per-call fees to use AI service agents (price-check, shopping, etc.). Every payment is recorded on-chain via a Monad smart contract, which pools 70% of revenue into a spending limit for a separate "spending agent." That spending agent uses a Rain-issued card to automatically pay the platform's own hosting, AI/API, and ad-hoc expenses — all gated by the on-chain limit, with a full audit trail.

## Actors
- **User** — visits the website, picks a service agent, chats with it, gets charged per call to their stored card (normal Stripe-style fiat charge).
- **Service agents** — e.g. "Price-Check Agent," "Shopping Agent." Each has its own identity/address. They do the actual work the user asked for (find a product, compare prices, etc.) and each tool-call/response is billable at a fixed rate (e.g. $0.05/call).
- **Treasury contract (Monad)** — on-chain ledger. Records every service agent's earnings, computes a pooled spend limit (70% of revenue), and gates every expense the spending agent tries to make.
- **Spending agent** — no user-facing chat. Its only job is to spend, within its on-chain-approved limit, on: recurring hosting bills, recurring AI/API costs, and manual expenses a human operator tells it to pay.
- **Rain** — issues the card the spending agent actually pays with. Its spending limit is kept in sync with the Treasury contract's `spendLimit` value.
- **Backend relay** — the glue: listens for Monad events, calls Rain's API to sync limits, receives Rain webhooks on real charges, and writes confirmations back on-chain.

## End-to-end flow
1. User picks a service agent on the site and chats with it (e.g. "find me a golf kit with 2 sticks").
2. Each agent action/tool-call during the session costs a fixed small fee; a running total is shown live in the UI.
3. When the chat ends, the accumulated total is charged to the user's stored card (Stripe or similar — this is a normal fiat transaction, not on-chain).
4. On successful charge, the backend calls `recordEarning(agentAddress, amount)` on the Monad Treasury contract.
5. The contract splits the amount 70/30: 70% is added to the pooled `spendLimit` available to the spending agent; 30% is retained.
6. The backend relay detects the `Earned` event and pushes the new `spendLimit` to Rain as the card's updated spending limit.
7. The spending agent (via backend, on a schedule or on manual trigger) calls `requestExpense(amount, category, description)` on the contract before paying any bill. The contract only approves it if the amount fits within the current `spendLimit`.
8. If approved, the backend actually charges the Rain card for that expense (hosting invoice, AI/API invoice, or a manually specified expense).
9. Rain's webhook confirms the real charge went through; the backend calls `confirmSpend(expenseId)` on-chain, closing the audit loop.
10. A dashboard shows, live: total earnings per agent, current spend limit, full expense log (category, amount, approved/confirmed status).

## Smart contract (already written — attached as Treasury.sol)
Key functions:
- `recordEarning(address agent, uint256 amount)` — owner-only (called by backend after a real fiat charge succeeds). Splits 70/30, updates pooled `spendLimit`.
- `requestExpense(uint256 amount, Category category, string description)` — called by the spending agent (or backend on its behalf). `Category` is `HOSTING`, `AI_API`, or `MANUAL`. Returns whether it was approved; decrements `spendLimit` if so.
- `confirmSpend(uint256 expenseId)` — owner-only, called after Rain webhook confirms the real charge.
- `remainingLimit()` — view function for the dashboard.

This contract is deliberately minimal for a hackathon timeline — no token transfers happen on-chain (it's a ledger/gate, not custody). Real money moves via Stripe (user → platform) and Rain (spending agent → vendors); Monad just enforces and records the rules.

## Components to build

### 1. Smart contract deployment
- Use Foundry. Deploy `Treasury.sol` to Monad testnet.
- Write a deploy script and a few test scripts exercising `recordEarning` / `requestExpense` / `confirmSpend`.

### 2. Backend service (Node.js + TypeScript recommended)
- **Payment webhook handler** — receives Stripe (or mocked) charge-succeeded events, triggers `recordEarning`.
- **Monad client** — use `viem` or `ethers` to read/write the contract, and to listen for `Earned` / `ExpenseRequested` events.
- **Rain client** — wraps Rain's card API: update card spending limit, and receive Rain's transaction webhook.
- **Expense endpoints** — one for recurring costs (triggered by a cron job checking hosting/AI-API invoices), one for manual expenses (a simple authenticated endpoint you call yourself with an amount + description).
- **Session/chat cost tracker** — tracks per-call cost during a user's chat session and totals it at session end.

### 3. Frontend (React + Tailwind recommended)
- Landing page: list of available service agents (Price-Check, Shopping, etc.), each clickable into a chat view.
- Chat UI: normal chat interface, with a running cost counter visible during the session and a total shown when the session ends.
- Dashboard page: live earnings per agent, current pooled spend limit, expense log with category/status, and ideally a feed of on-chain events for the "wow, it's really on-chain" moment during the demo.

### 4. Service agents
- **Price-Check Agent**: takes a natural-language product request, returns a matched product + price. For hackathon reliability, back it with a small local/mocked dataset rather than live scraping unless a real API is already working.
- Additional agents (Shopping Agent, etc.) are optional stretch goals — one working agent end-to-end beats three half-working ones.

### 5. Spending agent logic
- A cron job (e.g. runs every N minutes in the demo) that checks for due "hosting" and "AI/API" bills (can be mocked fixed amounts for the demo) and calls `requestExpense` then charges the Rain card if approved.
- A manual trigger (simple form or CLI) for ad-hoc expenses — same approval path.

## Tech stack
- **Chain**: Monad testnet, Solidity, Foundry
- **Backend**: Node.js + TypeScript, viem or ethers, Express or Fastify
- **Frontend**: React + Tailwind
- **User payments**: Stripe (test mode) for charging users
- **Card/spend rail**: Rain sandbox API
- **DB**: Postgres or SQLite for chat sessions, per-call cost logs, and a mirrored/cached view of on-chain state for fast dashboard rendering

## Build order (suggested milestones)
1. Deploy `Treasury.sol` to Monad testnet; confirm `recordEarning` / `requestExpense` / `confirmSpend` work via scripts.
2. Backend skeleton with a working Monad client (can read/write the contract).
3. Price-Check Agent + minimal chat UI with a live per-call cost counter (payment can be mocked at first).
4. Wire real session-end charge → `recordEarning` call.
5. Rain sandbox integration: issue a test card, sync its limit to `spendLimit` on each `Earned` event.
6. Spending agent: manual expense endpoint working end-to-end (request → approve → Rain charge → webhook → confirm on-chain).
7. Add one recurring expense type (e.g. mocked hosting bill) on a cron.
8. Dashboard showing live earnings, limit, and expense log.
9. Polish for demo: seed some fake historical data so the dashboard isn't empty at t=0, and rehearse the "watch the numbers move" moment.

## Open questions to flag back to me if unclear while building
- Whether we have real Rain sandbox credentials yet, or need to stub that client behind an interface until credentials arrive.
- Whether Price-Check Agent should use a real data source or a local mocked dataset (default: mocked, for demo reliability).
- Exact Monad testnet RPC URL / faucet being used for this hackathon.
