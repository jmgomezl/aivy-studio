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
export function deployBuyerAgent({ client, topicId, state, negotiationId, strategy, maxBudget, instructions }) {
  if (!STRATEGIES[strategy]) throw new Error(`unknown strategy: ${strategy}`);
  if (sessions.has(negotiationId)) throw new Error('buyer agent already active for this negotiation');
  const instr = (instructions || '').trim().slice(0, 600);
  const session = { strategy, round: 0, status: 'running', instructions: instr || null };
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

  // LLM-driven offer — honors the user's free-text instructions (goal price,
  // floor, persona, tactics), the budget ceiling, the persona, and reacts to the
  // seller's last response. Falls back to the deterministic playbook on failure.
  async function generateOffer({ round, totalRounds, prevVerdict, lastPrice, product }) {
    const sys =
      `You are an autonomous BUYER agent negotiating to BUY "${product}". ` +
      `Reply with ONLY compact JSON: {"price": <integer USD>, "argument": "<one short persuasive sentence to the seller>"}.\n` +
      `Hard rules:\n` +
      `- price is an integer in USD and MUST NOT exceed ${maxBudget} (your absolute max budget).\n` +
      `- Escalate gradually across rounds; this is round ${round} of ${totalRounds}, only approach your max near the final round.\n` +
      `- Persona/tone: ${strategy}.\n` +
      `- Obey the buyer's own instructions precisely (target/goal price, floor, ceiling, tactics, persona): "${instr || 'none'}".\n` +
      `- argument <= 240 characters.`;
    const user = prevVerdict
      ? `The seller did NOT accept your last offer of ${lastPrice} USD. Seller response: ${prevVerdict.decision}` +
        `${prevVerdict.counterPrice ? ` (counter ${prevVerdict.counterPrice})` : ''} — "${(prevVerdict.spokenVerdict || '').slice(0, 200)}". Make your next offer.`
      : `Make your opening offer.`;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-4o',
        temperature: 0.7,
        max_tokens: 160,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      }),
    });
    const data = await res.json();
    const out = JSON.parse(data.choices[0].message.content);
    let price = Math.round(Number(out.price));
    if (!Number.isFinite(price) || price < 1) price = 1;
    price = Math.min(price, maxBudget);
    return { price, argument: String(out.argument || '').slice(0, 1000) };
  }

  async function run() {
    const steps = STRATEGIES[strategy];
    const product = activeProduct();
    const useLLM = !!(instr && process.env.OPENAI_API_KEY);
    const totalRounds = useLLM ? 4 : steps.length;
    let lastPrice = 0;
    let prevVerdict = null;
    for (let i = 0; i < totalRounds; i++) {
      session.round = i + 1;
      let price, argument;
      if (useLLM) {
        try {
          ({ price, argument } = await generateOffer({ round: i + 1, totalRounds, prevVerdict, lastPrice, product }));
        } catch (e) {
          console.warn('[buyer-agent] LLM offer failed, falling back:', e.message);
          const step = steps[Math.min(i, steps.length - 1)];
          price = Math.max(1, Math.round(maxBudget * step.f));
          argument = step.arg(product);
        }
      } else {
        const step = steps[i];
        price = Math.max(1, Math.round(maxBudget * step.f));
        argument = step.arg(product);
      }
      price = Math.max(1, Math.min(price, maxBudget));
      lastPrice = price;
      console.log(`[buyer-agent:${strategy}${useLLM ? '+instr' : ''}] round ${session.round}: ${price} USD`);
      const seq = await publishOffer(price, argument);
      const verdict = await waitVerdictAfter(seq);
      if (!verdict) {
        session.status = 'timeout';
        break;
      }
      if (verdict.decision === 'accept') {
        session.status = 'closed';
        break;
      }
      prevVerdict = verdict;
      // counter above budget ends the negotiation honestly; otherwise escalate
      if (verdict.decision === 'counter' && verdict.counterPrice > maxBudget && i === totalRounds - 1) {
        session.status = 'budget-exceeded';
        break;
      }
      session.status = i === totalRounds - 1 ? 'rejected' : 'running';
      await sleep(2500); // theatrical pacing between rounds
    }
    if (session.status === 'running') session.status = 'done';
    // No deal → publish a terminal event so the negotiation reads as concluded.
    if (session.status !== 'closed') await publishDone(session.status, lastPrice);
    setTimeout(() => sessions.delete(negotiationId), 60_000);
  }
}
