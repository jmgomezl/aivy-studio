// Autonomous buyer agent — negotiates against the seller agent with a
// configurable strategy, no human in the loop. Each round publishes a real
// offer to the HCS-10 topic and waits for the seller's on-chain verdict.
import { TopicMessageSubmitTransaction } from '@hashgraph/sdk';
import { existsSync, readFileSync } from 'node:fs';

// The product the buyer agent is negotiating for (the active listing).
function activeProduct() {
  try {
    if (existsSync('data/active-listing.json')) {
      const a = JSON.parse(readFileSync('data/active-listing.json', 'utf8'));
      if (a?.name) return a.name;
    }
  } catch {}
  return 'this item';
}

// Strategy playbooks: escalating fractions of maxBudget + product-aware args.
const STRATEGIES = {
  aggressive: [
    { f: 0.6, arg: (p) => `I know the market for ${p}. This price is competitive — take it.` },
    { f: 0.78, arg: (p) => `I've compared similar listings on-chain. My offer is fair market value for ${p}.` },
    { f: 0.95, arg: (p) => `Final offer. My budget ceiling is firm — best price you'll get for ${p} today.` },
  ],
  charming: [
    { f: 0.55, arg: (p) => `I've been looking for ${p} like this for ages — exactly what I wanted.` },
    { f: 0.75, arg: (p) => `I genuinely appreciate ${p} of this quality. It would be in good hands with me.` },
    { f: 0.92, arg: (p) => `This ${p} deserves someone who'll truly value it. Let me honor it at this price.` },
  ],
  analytical: [
    { f: 0.58, arg: (p) => `Based on comparable ${p} listings, my offer sits within fair range.` },
    { f: 0.76, arg: (p) => `Adjusted for quality and condition, this offer carries a premium over baseline for ${p}.` },
    { f: 0.95, arg: (p) => `At this price the value-to-quality ratio for ${p} is optimal for both parties. Acceptance is rational.` },
  ],
  emotional: [
    { f: 0.5, arg: (p) => `This ${p} means more to me than I can explain. I really need it.` },
    { f: 0.72, arg: (p) => `I'm not just buying ${p} — I'm buying what it represents to me. Price is secondary.` },
    { f: 0.95, arg: (p) => `This is personal. Some things are worth more than the number — I'll pay what I can for this ${p}.` },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sessions = new Map(); // negotiationId -> { strategy, round, status }

export function getSession(negotiationId) {
  return sessions.get(negotiationId) ?? null;
}

/**
 * Run a buyer-agent session. Publishes offers to the topic and reads verdicts
 * from the shared backend state (chain-sourced). Returns immediately; progress
 * is visible through the normal event stream.
 */
export function deployBuyerAgent({ client, topicId, state, negotiationId, strategy, maxBudget }) {
  if (!STRATEGIES[strategy]) throw new Error(`unknown strategy: ${strategy}`);
  if (sessions.has(negotiationId)) throw new Error('buyer agent already active for this negotiation');
  const session = { strategy, round: 0, status: 'running' };
  sessions.set(negotiationId, session);
  run().catch((err) => {
    console.error('[buyer-agent]', err.message);
    session.status = 'error';
  });
  return session;

  async function publishOffer(price, argument) {
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(
        JSON.stringify({
          p: 'hcs-10',
          op: 'message',
          type: 'offer',
          negotiationId,
          buyer: `agent:${strategy}`,
          price,
          argument,
        })
      )
      .execute(client);
    const receipt = await tx.getReceipt(client);
    return Number(receipt.topicSequenceNumber);
  }

  async function waitVerdictAfter(seq, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const n = state.negotiations[negotiationId];
      if (n?.verdict && n.verdict.sequence > seq) return n.verdict;
      await sleep(2000);
    }
    return null;
  }

  // When the buyer agent ends WITHOUT a deal, announce it on-chain so the UI can
  // show an honest "ended · no deal" instead of "still negotiating" forever.
  async function publishDone(status, finalPrice) {
    try {
      const tx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify({
          p: 'hcs-10', op: 'message', type: 'buyer_done',
          negotiationId, buyer: `agent:${strategy}`, status, finalPrice: finalPrice ?? null,
        }))
        .execute(client);
      await tx.getReceipt(client);
    } catch (e) { console.warn('[buyer-agent] publishDone failed:', e.message); }
  }

  async function run() {
    const steps = STRATEGIES[strategy];
    const product = activeProduct();
    let lastPrice = 0;
    for (let i = 0; i < steps.length; i++) {
      session.round = i + 1;
      const price = Math.max(1, Math.round(maxBudget * steps[i].f));
      lastPrice = price;
      console.log(`[buyer-agent:${strategy}] round ${session.round}: ${price} HBAR`);
      const seq = await publishOffer(price, steps[i].arg(product));
      const verdict = await waitVerdictAfter(seq);
      if (!verdict) {
        session.status = 'timeout';
        break;
      }
      if (verdict.decision === 'accept') {
        session.status = 'closed';
        break;
      }
      // counter above budget ends the negotiation honestly; otherwise escalate
      if (verdict.decision === 'counter' && verdict.counterPrice > maxBudget && i === steps.length - 1) {
        session.status = 'budget-exceeded';
        break;
      }
      session.status = i === steps.length - 1 ? 'rejected' : 'running';
      await sleep(2500); // theatrical pacing between rounds
    }
    if (session.status === 'running') session.status = 'done';
    // No deal → publish a terminal event so the negotiation reads as concluded.
    if (session.status !== 'closed') await publishDone(session.status, lastPrice);
    setTimeout(() => sessions.delete(negotiationId), 60_000);
  }
}
