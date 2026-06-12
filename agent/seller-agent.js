// Kickoff seller agent engine.
// Polls the HCS-10 negotiation topic via Mirror Node, evaluates each new offer
// (price + argument), publishes its reasoning and verdict back to the topic,
// and speaks the verdict via ElevenLabs. Audio is generated BEFORE any on-chain
// settlement so the voice plays while the transaction confirms.
import 'dotenv/config';
import { evaluateOffer } from './evaluate.js';
import { speakVerdict } from './voice.js';
import { agentClient, fetchTopicMessages, publishMessage } from './hedera.js';

const TOPIC = process.env.HCS10_NEGOTIATION_TOPIC;
const POLL_MS = Number(process.env.AGENT_POLL_MS || 2500);

const ctx = {
  productName: process.env.PRODUCT_NAME || 'Specialty Coffee — Single Origin',
  currency: 'HBAR',
  minPrice: Number(process.env.SELLER_MIN_PRICE_HBAR || 25),
  history: [],
};

const client = agentClient();
let lastSeq = 0;
let running = true;

export async function handleOffer(offer) {
  console.log(`[agent] offer #${offer.negotiationId} — ${offer.price} HBAR — "${offer.argument?.slice(0, 80)}"`);

  await publishMessage(client, TOPIC, {
    type: 'agent_status',
    negotiationId: offer.negotiationId,
    status: 'evaluating',
  });

  const verdict = await evaluateOffer(offer, ctx);
  ctx.history.push({ offer, verdict });

  // Reasoning first — drives the arena feed and the probability meter.
  await publishMessage(client, TOPIC, {
    type: 'agent_reasoning',
    negotiationId: offer.negotiationId,
    sellProbability: verdict.sellProbability,
    reasoning: verdict.reasoning,
    source: verdict.source,
  });

  // Voice before settlement — theatrical timing.
  const audioPath = await speakVerdict(verdict.spokenVerdict);

  await publishMessage(client, TOPIC, {
    type: 'agent_verdict',
    negotiationId: offer.negotiationId,
    decision: verdict.decision,
    counterPrice: verdict.counterPrice,
    spokenVerdict: verdict.spokenVerdict,
    audio: audioPath ?? undefined,
  });

  console.log(`[agent] verdict: ${verdict.decision} (p=${verdict.sellProbability}, ${verdict.source})`);
  return verdict;
}

async function loop() {
  console.log(`[agent] seller agent ${process.env.SELLER_AGENT_ACCOUNT_ID} watching topic ${TOPIC}`);
  while (running) {
    try {
      const messages = await fetchTopicMessages(TOPIC, lastSeq);
      for (const m of messages) {
        lastSeq = Math.max(lastSeq, m.sequence);
        if (m.json?.type === 'offer') {
          await handleOffer({
            negotiationId: m.json.negotiationId ?? String(m.sequence),
            buyer: m.json.buyer,
            price: Number(m.json.price),
            argument: m.json.argument,
          });
        }
      }
    } catch (err) {
      console.warn('[agent] loop error (continuing):', err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (process.argv[1].endsWith('seller-agent.js')) {
  process.on('SIGINT', () => {
    running = false;
    client.close();
    process.exit(0);
  });
  loop();
}
