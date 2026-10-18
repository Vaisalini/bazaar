# Bazaar 🛍️

### 🔴 Live demo: **[bazaar-5cbf8.web.app](https://bazaar-5cbf8.web.app)** · no sign-up, just type a request

**The agent-to-agent commerce network for local shops.**

90% of Indian retail is offline and invisible to the internet — 13 million shops with no catalogs, no apps, no digital presence. Bazaar gives every shop an AI agent that learns the business *through conversation* (text or voice note), and gives every customer a buyer agent that discovers, queries, and **negotiates with all of them in parallel** — closing the best deal in about a minute.

> *"I need a 1kg eggless chocolate cake under ₹500 by 6pm near Andheri"* → 4 shop agents bid, counter, and haggle live → deal closed at ₹430 with an order ticket.

Built for the **AI Builder Cup 2026** · Theme: **Retail & Commerce — Intelligent Customer and Business Experiences**

## ✨ What it does

| Side | Experience |
|---|---|
| **Customer** | One sentence (typed or spoken) → live "negotiation theatre" where their agent haggles with every matching shop agent simultaneously → order ticket with price, fulfillment (pickup/delivery), shop address + Maps link, ready-by time, and payment terms |
| **Shopkeeper** | Describes the shop in plain English/Hindi/Hinglish — chat or voice note. No forms, no catalogs. Gemini extracts a structured profile (items, prices, price floors, negotiation personality) and the shop's agent starts selling 24/7 |

Key mechanics:
- **Multi-round negotiation** with offers, counters, accepts, rejects — and honest dropouts when a shop can't fulfil a request
- **Price floors enforced in code**, not prompts — agents can never sell below the owner's limit
- **Budget guard in code** — the buyer agent can never accept above the customer's budget
- **Location-aware matching** — shops near the customer are ranked first ("📍 near you")
- **Voice notes transcribed by Gemini** (audio understanding) — works in every browser, every language
- **Privacy by design** — exact addresses are exchanged only after a deal closes, and only with the winning shop

## 🏗️ Architecture

```
Customer / Shopkeeper (React + Vite, Firebase Hosting)
        │
        ├── Firebase Auth (anonymous — zero-friction access)
        ├── Firebase App Check (reCAPTCHA v3 / debug provider)
        │
        ├── Firebase AI Logic (firebase/ai SDK) ──► Gemini
        │     • buyer-intent parsing (structured JSON output)
        │     • shop onboarding: conversation → structured catalog
        │     • persona-conditioned agent-to-agent negotiation
        │     • voice-note transcription (audio understanding)
        │     • deal summaries
        │
        └── Cloud Firestore
              • shops (profiles, items, price floors, personas)
              • requests + live negotiation event log
                (UI streams every bid/counter via onSnapshot)
```

- **Gemini** (via **Firebase AI Logic**) powers every intelligent step — remove it and nothing remains. Model fallback chain (`gemini-3.8-flash` → older flash/flash-lite versions) for quota resilience.
- **Firestore** is the system of record *and* the real-time transport: every negotiation turn is an event document streamed live to the UI.
- **Firebase Hosting + Auth + App Check** serve and protect the app.
- `backend/` contains the **Cloud Run production architecture** (containerized Node.js orchestrator, Dockerfile included) — the path for scaling beyond the free-tier prototype: server-side orchestration, WhatsApp Business API webhooks, payments.

### A note on agent isolation (honest engineering trade-off)

In this free-tier prototype, each negotiation **round** is batched: one Gemini call produces every shop agent's move (each conditioned on its own persona, inventory, and private price floor), and one call produces the buyer agent's reactions. This fits the Gemini free tier's rate limits (~5 req/min) while preserving identical agent semantics — per-agent state, personas, and floors are maintained in the orchestrator, and floors/budgets are enforced **in code**, never trusted to the model.

The `backend/` Cloud Run orchestrator implements the same state machine with **fully isolated per-agent calls** (one model context per shop), which is the production deployment: it also moves price floors server-side so buyers' clients never see them. Batching is a deployment optimization, not a capability claim.

## 🚀 Run it locally

Prereqs: Node 20+, a Firebase project (Spark plan is enough) with **Firestore**, **Anonymous Auth**, and **AI Logic (Gemini Developer API)** enabled.

```bash
cd frontend
cp .env.example .env   # fill in your Firebase web-app config
npm install
npm run dev            # http://localhost:5173
```

- Publish `firestore.rules` (repo root) in the Firebase console → Firestore → Rules.
- For local dev with App Check enforced, register a debug token (console → App Check → Apps → Manage debug tokens) and set `VITE_APPCHECK_DEBUG_TOKEN`.
- Demo shops auto-seed on first load (16 shops across bakery, pharmacy, electronics, stationery, kirana).

## 🌐 Deploy

```bash
cd frontend && npm run build
firebase deploy        # from repo root — deploys Hosting + Firestore rules
```

For production, register the web app with **reCAPTCHA v3** in App Check and set `VITE_RECAPTCHA_SITE_KEY` before building.

## 📁 Repo layout

```
frontend/              the deployed app (React + Vite + Tailwind)
  src/agents/          Gemini orchestration: intent, negotiation engine, onboarding, transcription
  src/components/      negotiation theatre UI, onboarding chat, voice input
  src/data/shops.json  seeded demo marketplace
backend/               Cloud Run production architecture (reference implementation + Dockerfile)
firebase.json          Hosting + Firestore deploy config
firestore.rules        security rules
BAZAAR_MASTER_PLAN.md  full product thinking: scenario, judging-criteria mapping, roadmap
```

## 🗺️ Beyond the prototype

- **WhatsApp Business API** — shop agents live on the number the shop already has
- **Onboarding ladder**: chat/voice today → 📸 photo of price board (Gemini vision) → claim-your-Google-Maps-listing (1 tap) → *lazy onboarding* (the agent builds the catalog from real customer demand)
- **Payments**: UPI deep links at deal time → escrow for high-trust orders
- **Delivery**: courier API integration (Porter/Borzo-style) for shops without delivery staff
- **Cloud Run orchestrator** (see `backend/`) for server-side scale

---

*Demo data notice: all shops in the prototype are seeded demo data; the shopkeeper onboarding flow creates real entries that immediately participate in negotiations.*
