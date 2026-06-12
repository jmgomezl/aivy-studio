// Autonomous buyer agent — negotiates against the seller agent with a
// configurable strategy, no human in the loop. Each round publishes a real
// offer to the HCS-10 topic and waits for the seller's on-chain verdict.
import { TopicMessageSubmitTransaction } from '@hashgraph/sdk';

// Strategy playbooks: escalating fractions of maxBudget + arguments in character.
const STRATEGIES = {
  aggressive: [
    { f: 0.6, arg: 'I know the market. This price is competitive for what you are offering. Take it.' },
    { f: 0.78, arg: 'I have analyzed comparable specialty lots on Hedera. My offer reflects fair market value for single-origin Huila.' },
    { f: 0.95, arg: 'Final offer. My budget ceiling is firm. This is the best price you will get today.' },
  ],
  charming: [
    { f: 0.55, arg: 'I have been searching for a coffee like this for months — washed Huila is exactly what I have been chasing.' },
    { f: 0.75, arg: 'I have visited farms in Huila and I brew V60 every morning. The jasmine notes of this lot deserve a careful hand, and mine are.' },
    { f: 0.92, arg: 'You grow something extraordinary. I want to share it, not just consume it. Let me honor it at this price.' },
  ],
  analytical: [
    { f: 0.58, arg: 'Market data: specialty washed Huila trades in a defined band. My offer sits within fair range.' },
    { f: 0.76, arg: 'Adjusted for origin premium and altitude, this offer carries a 15% premium over baseline. Analytically sound.' },
    { f: 0.95, arg: 'Final computation: at this price the value-to-quality ratio is optimal for both parties. Acceptance is rational.' },
  ],
  emotional: [
    { f: 0.5, arg: 'My grandmother grew coffee in the mountains. This lot smells like her kitchen. I need this.' },
    { f: 0.72, arg: 'I am not buying coffee. I am buying a memory of a place I love. The price is secondary to what it means.' },
    { f: 0.95, arg: 'This is personal. Some things are worth more than the number. I will pay what it takes within my means.' },
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

  async function run() {
    const steps = STRATEGIES[strategy];
    for (let i = 0; i < steps.length; i++) {
      session.round = i + 1;
      const price = Math.max(1, Math.round(maxBudget * steps[i].f));
      console.log(`[buyer-agent:${strategy}] round ${session.round}: ${price} HBAR`);
      const seq = await publishOffer(price, steps[i].arg);
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
    setTimeout(() => sessions.delete(negotiationId), 60_000);
  }
}
