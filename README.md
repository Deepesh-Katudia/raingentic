# PayHive

An agentic earn-to-spend platform concept: AI service agents earn small per-call fees from users, and a share of that revenue is meant to fund a separate spending agent that pays the platform's own bills (hosting, AI APIs, etc.) through a Rain-issued card, gated by an on-chain spend limit on Monad.

This repo is currently the **frontend and chat layer** of that idea. The on-chain Treasury contract, Rain card integration, and Stripe billing described in `data/PROJECT_SPEC.md` are designed but not wired up yet — everything here runs on mocked data plus one real integration (Groq for chat replies).

## What's in here

- **`frontend/`** — React 19 + TypeScript + Vite app.
  - Landing page listing 28 mock service agents (search + pagination).
  - A chat screen per agent with real LLM replies (via the relay below), session cost tracking, and per-agent chat history saved to `localStorage`.
  - Sign-in and a payment card are required before an agent can be used — both are mocked (no real auth/payments), but enforced the same way a real flow would gate access.
  - An admin dashboard with live-updating mocked earnings, spend limit, and expense log.
- **`server/`** — a small Express relay. Its only job is holding the Groq API key server-side and forwarding chat requests to Groq's API, so the key never ends up in the browser bundle. If it isn't running, the chat falls back to mocked replies instead of failing.
- **`data/`** — the original project spec and the `Treasury.sol` contract referenced by it, kept for context.

## Running it locally

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`.

### Chat relay (optional, but needed for real agent replies)

```bash
cd server
npm install
npm run dev
```

Runs at `http://localhost:8787`. Needs a `GROQ_API_KEY` in a `.env` file at the repo root (one level above `server/`):

```
GROQ_API_KEY=your_groq_key_here
```

Get a free key at [console.groq.com](https://console.groq.com).

## Demo login

There's no real backend yet, so sign-in and card entry are mocked:

- Email/password and test card values live in `frontend/.env` as `VITE_DEMO_EMAIL`, `VITE_DEMO_PASSWORD`, and `VITE_DEMO_CARD_*`.
- The wallet form is pre-filled with a well-known Stripe test card number by default.

## Tech stack

- React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Zustand
- Express + Groq API (Llama 3.3) for the chat relay

## Status

Frontend and chat work end-to-end with real LLM replies and a working sign-in/payment gate. The Treasury contract, Rain integration, and real billing are not implemented — this is a UI and chat prototype, not the full platform.
