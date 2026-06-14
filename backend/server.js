// Kickoff backend — Express + WebSocket relay.
// Single mirror-node poller fans events out to every connected client (lesson A:
// one server-side read path, clients never hit Hedera directly). Offers come in
// via REST and are published to the HCS-10 topic; the seller agent picks them
// up from the topic, so the chain is the single source of truth end-to-end.
import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  Client,
  PrivateKey,
  TopicMessageSubmitTransaction,
} from '@hashgraph/sdk';
import { fetchTopicMessages } from '../agent/hedera.js';
import { deployBuyerAgent, getSession } from './buyer-agent.js';
import { createListing, getPublicListings, getActiveListing, markSold } from './listings.js';
import { rpSignature, verifyProof, worldIdEnabled, worldConfig } from './worldid.js';
import { validateWorkflow, WorkflowValidationError } from './workflow-schema.js';
import { saveWorkflow, getWorkflow, listWorkflows } from './workflows.js';
import { executeDryRun } from './workflow-executor.js';
import { computeReputation } from './reputation.js';
import { sellerChat } from './chat.js';
import {
  telegramAuthEnabled,
  verifyTelegramAuth,
  getOrCreateSellerWallet,
  issueSession,
  verifySession,
} from './telegram-auth.js';
import { readBalances } from './lib/faucet.js';
import { resolveAgent, reverseName } from './ens.js';

const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'cryptokickoffbot';

const PORT = Number(process.env.PORT || 8787);
const TOPIC = process.env.HCS10_NEGOTIATION_TOPIC;
const POLL_MS = Number(process.env.BACKEND_POLL_MS || 2000);

const operator = Client.forTestnet();
operator.setOperator(
  process.env.HEDERA_OPERATOR_ID,
  PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY)
);

const app = express();
app.use(express.json({ limit: '8mb' })); // generous for listing photos (base64)
app.use('/audio', express.static('audio')); // agent-generated verdict mp3s
app.use('/uploads', express.static('uploads')); // listing photos
// Same files under /api so they load on subdomains whose nginx only proxies /api
// (arena/studio) — a bare /uploads path there falls through to the SPA index.html.
app.use('/api/audio', express.static('audio'));
app.use('/api/uploads', express.static('uploads'));
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// In-memory negotiation state, rebuilt from the topic (chain = source of truth).
const state = {
  negotiations: {}, // negotiationId -> { offers: [], reasoning: [], verdict, status }
  feed: [],         // last 100 raw events for late joiners
  lastSeq: 0,
};

function negotiation(id) {
  return (state.negotiations[id] ??= {
    negotiationId: id,
    offers: [],
    reasoning: [],
    verdict: null,
    status: 'open',
  });
}

function applyMessage(m) {
  const j = m.json;
  if (!j?.type) return null;
  const event = { ...j, sequence: m.sequence, consensusAt: m.consensusAt };
  const n = j.negotiationId ? negotiation(j.negotiationId) : null;
  switch (j.type) {
    case 'offer':
      n.offers.push(event);
      n.status = 'evaluating';
      break;
    case 'agent_status':
      n.status = j.status;
      break;
    case 'agent_reasoning':
      n.reasoning.push(event);
      n.sellProbability = j.sellProbability;
      break;
    case 'agent_verdict':
      n.verdict = event;
      n.status = j.decision === 'accept' ? 'closed' : j.decision === 'counter' ? 'countered' : 'rejected';
      break;
    case 'settlement':
      n.settlement = event;
      break;
    case 'insurance':
      n.insurance = event;
      break;
    case 'escrow':
      // locked → released/refunded; keep the latest leg on the negotiation.
      n.escrow = event;
      break;
    case 'payment':
      // real buyer-funded KUSD settlement of the negotiated amount.
      n.payment = event;
      break;
    case 'swap_status':
      n.swapStatus = event;
      break;
    case 'swap':
      // cross-asset payout via Uniswap (seller's chosen token).
      n.swap = event;
      break;
    case 'reveal': {
      n.reveal = event;
      // Deal closed → mark the active listing SOLD with the accepted price.
      const active = getActiveListing();
      if (active?.id) markSold(active.id, j.acceptedPrice);
      break;
    }
  }
  state.feed.push(event);
  if (state.feed.length > 100) state.feed.shift();
  return event;
}

// ── REST ──
app.get('/api/state', (_, res) => res.json(state));

app.get('/api/negotiations/:id', (req, res) => {
  const n = state.negotiations[req.params.id];
  if (!n) return res.status(404).json({ error: 'unknown negotiation' });
  res.json(n);
});

// Judge/buyer submits an offer: published straight to the HCS-10 topic.
app.post('/api/offer', async (req, res) => {
  try {
    const { negotiationId, price, argument, buyer, authToken, insured, escrow } = req.body || {};
    if (!negotiationId || !Number(price) || !argument?.trim()) {
      return res.status(400).json({ error: 'negotiationId, price and argument are required' });
    }
    // A verified Telegram session attributes the offer to that identity (can't be forged).
    const session = authToken ? verifySession(authToken) : null;
    const offerBuyer = session ? `tg:${session.username || session.telegramId}` : buyer || 'anonymous';
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(TOPIC)
      .setMessage(
        JSON.stringify({
          p: 'hcs-10',
          op: 'message',
          type: 'offer',
          negotiationId,
          buyer: offerBuyer,
          price: Number(price),
          argument: argument.trim().slice(0, 1000),
          ...(insured ? { insured: true } : {}),
          ...(escrow ? { escrow: true } : {}),
          // Carry the buyer's funded managed-wallet address so the agent can settle
          // the real amount in KUSD (and refund escrow) buyer→seller on close.
          ...(session?.walletEvm ? { buyerAddress: session.walletEvm } : {}),
        })
      )
      .execute(operator);
    const receipt = await tx.getReceipt(operator);
    res.json({
      ok: true,
      sequence: receipt.topicSequenceNumber?.toString(),
      txId: tx.transactionId.toString(),
    });
  } catch (err) {
    console.error('[api/offer]', err.message);
    res.status(500).json({ error: 'failed to publish offer' });
  }
});

// Deploy an autonomous buyer agent for a negotiation.
app.post('/api/deploy-buyer', (req, res) => {
  try {
    const { negotiationId, strategy = 'charming', maxBudget } = req.body || {};
    if (!negotiationId || !Number(maxBudget)) {
      return res.status(400).json({ error: 'negotiationId and maxBudget are required' });
    }
    const session = deployBuyerAgent({
      client: operator,
      topicId: TOPIC,
      state,
      negotiationId,
      strategy,
      maxBudget: Number(maxBudget),
    });
    res.json({ ok: true, session });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.get('/api/buyer-session/:id', (req, res) => {
  res.json(getSession(req.params.id) ?? { status: 'none' });
});

// ── World ID 4.0 (proof-of-human) ──
app.get('/api/world/config', (_, res) =>
  res.json({ enabled: worldIdEnabled, appId: worldConfig.appId ?? null, rpId: worldConfig.rpId ?? null, action: worldConfig.action })
);

// 1. Sign a proof request with our RP signing key.
app.post('/api/world/rp-signature', (req, res) => {
  if (!worldIdEnabled) return res.status(400).json({ error: 'World ID not configured' });
  try {
    res.json(rpSignature(req.body?.action));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Verify the returned IDKit proof + enforce one-offer-per-human.
app.post('/api/world/verify', async (req, res) => {
  const { idkitResponse, scope } = req.body || {};
  if (!idkitResponse) return res.status(400).json({ error: 'idkitResponse required' });
  const result = await verifyProof(idkitResponse, scope);
  if (!result.ok) return res.status(400).json({ ok: false, detail: result.detail });
  res.json({ ok: true, nullifier: result.nullifier });
});

// ── Telegram Login (web seller identity, no wallet) ──
app.get('/api/auth/config', (_, res) =>
  res.json({ enabled: telegramAuthEnabled, botUsername: TELEGRAM_BOT_USERNAME })
);

// Verify the Telegram widget payload → mint/lookup the seller's managed wallet →
// issue a signed session. The client never handles a key.
app.post('/api/auth/telegram', async (req, res) => {
  const result = verifyTelegramAuth(req.body || {});
  if (!result.ok) return res.status(401).json({ ok: false, error: `telegram auth failed (${result.reason})` });
  try {
    const wallet = await getOrCreateSellerWallet(result.profile, { operatorClient: operator });
    const token = issueSession(result.profile, wallet.evmAddress);
    res.json({
      ok: true,
      token,
      profile: {
        telegramId: result.profile.telegramId,
        username: result.profile.username,
        photoUrl: result.profile.photoUrl,
        walletEvm: wallet.evmAddress,
        // Prefer the real provisioned account id once funded; fall back to the alias.
        hederaAccount: wallet.hederaAccount || wallet.hederaAlias || (wallet.evmAddress ? `0.0.${wallet.evmAddress.slice(2).toLowerCase()}` : null),
        funded: !!wallet.funded,
        fundedUsd: wallet.fundedUsd || 0,
        gasHbar: wallet.gasHbar || 0,
      },
    });
  } catch (err) {
    console.error('[api/auth/telegram]', err.message);
    res.status(500).json({ ok: false, error: 'could not provision seller wallet' });
  }
});

// Live KUSD + HBAR balance for a funded wallet (mirror node).
app.get('/api/wallet/balance', async (req, res) => {
  const acct = req.query.account || req.query.evm;
  if (!acct) return res.status(400).json({ error: 'account or evm required' });
  const bal = await readBalances(acct);
  if (!bal) return res.status(404).json({ error: 'account not found / not indexed yet' });
  res.json({ ok: true, ...bal, tokenSymbol: 'KUSD' });
});

// ── Conversational chat with the seller agent (off-chain negotiation layer) ──
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history, productName } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });
    const name = productName || getActiveListing()?.name || process.env.PRODUCT_NAME || 'this item';
    const reply = await sellerChat({
      message: message.trim(),
      history: Array.isArray(history) ? history : [],
      productName: name,
    });
    res.json({ ok: true, reply });
  } catch (err) {
    console.error('[api/chat]', err.message);
    res.status(500).json({ error: 'chat failed' });
  }
});

// ── ERC-8004 agent identity (Trustless Agents — on-chain registry on Hedera EVM) ──
// Live ENS resolution — the agent identity card is READ from ENS at request
// time (forward: name → address + text records). Nothing hard-coded.
app.get('/api/ens/agent', async (_, res) => {
  try {
    res.json({ ok: true, ...(await resolveAgent()) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Reverse resolution — any EVM address → its primary .eth name (live, or null).
app.get('/api/ens/reverse', async (req, res) => {
  const address = req.query.address;
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    res.json({ ok: true, address, name: await reverseName(address) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/api/agent-identity', (_, res) => {
  const registry = process.env.ERC8004_REGISTRY_ADDRESS || null;
  if (!registry) return res.json({ enabled: false });
  res.json({
    enabled: true,
    standard: 'ERC-8004',
    chain: 'hedera-testnet-evm',
    registry,
    agentId: process.env.ERC8004_AGENT_ID || null,
    agentDomain: process.env.ERC8004_AGENT_DOMAIN || null,
    agentAddress: process.env.EVM_OPERATOR_ADDRESS || '0x44f7769bFB6E872f491CcF0B655Bee8c06A640a0',
    registerTx: process.env.ERC8004_REGISTER_TX || null,
    explorer: `https://hashscan.io/testnet/contract/${registry}`,
  });
});

// ── Reputation (eBay-style trust: sales / purchases / tier) ──
app.get('/api/reputation', (req, res) => {
  const rep = computeReputation(getPublicListings(), state.negotiations);
  if (req.query.id) {
    return res.json(rep[req.query.id] || { id: req.query.id, sales: 0, buys: 0, listings: 0, offers: 0, volumeHbar: 0, deals: 0, tier: 'new' });
  }
  res.json({ reputation: rep });
});

// ── Seller listings ──
app.get('/api/listings', (_, res) => res.json({ listings: getPublicListings(), active: getActiveListing() }));

app.post('/api/listings', async (req, res) => {
  try {
    const { name, description, category, minPriceHbar, photoDataUrl, seller, authToken, requireHumanVerification, payoutToken } = req.body || {};
    // A verified Telegram session overrides the client-sent seller (can't be forged).
    const session = authToken ? verifySession(authToken) : null;
    const verifiedSeller = session ? `tg:${session.username || session.telegramId}` : null;
    const listing = await createListing({
      name,
      description,
      category,
      minPriceHbar,
      photoDataUrl,
      seller: verifiedSeller || seller,
      sellerWalletEvm: session?.walletEvm || null,
      requireHumanVerification,
      payoutToken,
    });
    res.json({ ok: true, listing });
  } catch (err) {
    console.error('[api/listings]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── Studio workflows (Phase 1: validated ingestion + read-back, no execution) ──
// Custom Studio graphs are published here. This path is fully isolated from the
// live Kickoff flow — it never touches the topic poller, /api/offer, or the
// seller agent. Storing a workflow does NOT run it.
app.get('/api/workflows', (_, res) => res.json({ workflows: listWorkflows() }));

app.get('/api/workflows/:id', (req, res) => {
  const workflow = getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'unknown workflow' });
  res.json({ workflow });
});

app.post('/api/workflows', (req, res) => {
  try {
    const canonical = validateWorkflow(req.body, { fallbackName: 'Untitled workflow' });
    const requestedId = typeof req.body?.id === 'string' ? req.body.id : undefined;
    const saved = saveWorkflow(canonical, { id: requestedId });
    res.json({ ok: true, workflow: saved });
  } catch (err) {
    if (err instanceof WorkflowValidationError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    console.error('[api/workflows]', err.message);
    res.status(500).json({ error: 'failed to store workflow' });
  }
});

// Dry-run an inline graph (current unsaved canvas). Validate → simulate → return
// a deterministic event timeline. SIMULATION ONLY — touches no chain, no topic,
// no agent. Every step is flagged simulated:true.
app.post('/api/workflows/dry-run', (req, res) => {
  try {
    const canonical = validateWorkflow(req.body, { fallbackName: 'Untitled workflow' });
    const result = executeDryRun(canonical, { runId: `dry-${Date.now().toString(36)}` });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof WorkflowValidationError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    console.error('[api/workflows/dry-run]', err.message);
    res.status(500).json({ error: 'failed to dry-run workflow' });
  }
});

// Dry-run a previously stored workflow by id.
app.post('/api/workflows/:id/dry-run', (req, res) => {
  const workflow = getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'unknown workflow' });
  const result = executeDryRun(workflow, { runId: `dry-${Date.now().toString(36)}` });
  res.json({ ok: true, ...result });
});

// ── WebSocket ──
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'snapshot', state }));
});

function broadcast(event) {
  const msg = JSON.stringify({ type: 'event', event });
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
}

// ── Mirror-node poller (single read path for everyone) ──
async function poll() {
  try {
    const messages = await fetchTopicMessages(TOPIC, state.lastSeq);
    for (const m of messages) {
      state.lastSeq = Math.max(state.lastSeq, m.sequence);
      const event = applyMessage(m);
      if (event) broadcast(event);
    }
  } catch (err) {
    console.warn('[poll]', err.message);
  } finally {
    setTimeout(poll, POLL_MS);
  }
}

server.listen(PORT, () => {
  console.log(`[backend] http+ws on :${PORT} — relaying topic ${TOPIC}`);
  poll();
});
