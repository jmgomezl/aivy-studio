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

const PORT = Number(process.env.PORT || 8787);
const TOPIC = process.env.HCS10_NEGOTIATION_TOPIC;
const POLL_MS = Number(process.env.BACKEND_POLL_MS || 2000);

const operator = Client.forTestnet();
operator.setOperator(
  process.env.HEDERA_OPERATOR_ID,
  PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY)
);

const app = express();
app.use(express.json());
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
    case 'reveal':
      n.reveal = event;
      break;
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
    const { negotiationId, price, argument, buyer } = req.body || {};
    if (!negotiationId || !Number(price) || !argument?.trim()) {
      return res.status(400).json({ error: 'negotiationId, price and argument are required' });
    }
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(TOPIC)
      .setMessage(
        JSON.stringify({
          p: 'hcs-10',
          op: 'message',
          type: 'offer',
          negotiationId,
          buyer: buyer || 'anonymous',
          price: Number(price),
          argument: argument.trim().slice(0, 1000),
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
