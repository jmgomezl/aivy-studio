# Aivy Studio

**A visual canvas for orchestrating multi-agent workflows on Hedera** — think **n8n, but for AI agents**.

Ships with **Kickoff.bot**, the first pre-built template: a P2P agent-driven negotiation marketplace where AI agents negotiate on behalf of buyers and sellers in real time, fully on-chain on Hedera.

> ETHGlobal NYC · June 12–14, 2026

**Live:**
🎛 [studio.aivylabs.xyz](https://studio.aivylabs.xyz) — the canvas ·
🛒 [kickoff.bot](https://kickoff.bot) — the marketplace ·
📺 [arena.kickoff.bot](https://arena.kickoff.bot) — live negotiation feed ·
✈️ [@cryptokickoffbot](https://t.me/cryptokickoffbot) — Telegram Mini App ·
🧬 part of the [Aivy](https://github.com/jmgomezl/aivy) ecosystem ([aivylabs.xyz](https://aivylabs.xyz))

## Products

### Kickoff.bot (standalone)
A buyer makes an offer (Telegram Mini App or web) with a price **and an argument**. A seller agent — with a personality, a minimum price committed on-chain, and emotional criteria — decides autonomously whether to sell. The agent speaks its verdict via ElevenLabs voice. Everything executes on Hedera.

### Aivy Studio (canvas)
Visual node graph (@xyflow/react) for composing agent workflows. The Kickoff template loads the full negotiation flow as connected nodes: seller agent, buyer agent, HCS-10 communication layer, HTS escrow, Ledger approval gate.

## Stack
- **Hedera** — HCS-10/OpenConvAI (agent identity + messaging), HTS (escrow in HBAR), EVM smart contract (commitment scheme + collateral), Scheduled Transactions (Ledger pre-sign)
- **Hedera Agent Kit** — agent orchestration
- **Ledger** — pre-signed delegation policy (sign once, agent operates within limits)
- **OpenAI GPT-4o** — agent reasoning (model-agnostic)
- **ElevenLabs** — agent voice
- **Node.js · Express · WebSocket · Telegraf · React 18 + Vite · i18next (ES/EN)**

## Structure
```
contracts/    Hedera EVM — commitment + collateral
agent/        Seller + buyer agent engines
backend/      Express + WebSocket + Telegram bot
frontend/     Mini App (Offer), Arena live feed, Aivy Studio canvas
templates/    kickoff.json — template node graph
scripts/      demo-setup.js, create-topic.js, check-agent-kit.js
```

## Setup
```bash
npm install
cp .env.example .env   # fill credentials
node scripts/check-agent-kit.js   # verify Hedera connection
node scripts/create-topic.js      # create HCS-10 negotiation topic
```
