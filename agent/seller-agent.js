// Kickoff seller agent engine.
// Polls the HCS-10 negotiation topic via Mirror Node, evaluates each new offer
// (price + argument), publishes its reasoning and verdict back to the topic,
// and speaks the verdict via ElevenLabs. Audio is generated BEFORE any on-chain
// settlement so the voice plays while the transaction confirms.
import 'dotenv/config';
import { evaluateOffer } from './evaluate.js';
import { speakVerdict } from './voice.js';
import { agentClient, fetchTopicMessages, publishMessage } from './hedera.js';
import { escrowClient, releaseEscrow } from './escrow.js';

// Testnet-budget guard: the on-chain settlement moves a symbolic amount no
// matter what price was negotiated, so demos can't drain the faucet balance.
const SETTLE_CAP_HBAR = Number(process.env.DEMO_SETTLE_HBAR || 1);

const TOPIC = process.env.HCS10_NEGOTIATION_TOPIC;
const POLL_MS = Number(process.env.AGENT_POLL_MS || 2500);

import { existsSync, readFileSync } from 'node:fs';

const ctx = {
  productName: process.env.PRODUCT_NAME || 'Specialty Coffee — Single Origin',
  currency: 'HBAR',
  minPrice: Number(process.env.SELLER_MIN_PRICE_HBAR || 25),
  history: [],
};

// If a seller created a listing, defend THAT reserve (written server-side by
// the listings module). Falls back to the env default.
function refreshActiveListing() {
  try {
    if (existsSync('data/active-listing.json')) {
      const a = JSON.parse(readFileSync('data/active-listing.json', 'utf8'));
      if (a?.minPriceHbar) {
        ctx.minPrice = Number(a.minPriceHbar);
        ctx.productName = a.name || ctx.productName;
        ctx.activeListingId = a.id;
      }
    }
  } catch {}
}

const client = agentClient();
let lastSeq = 0;
let running = true;

export async function handleOffer(offer) {
  refreshActiveListing(); // defend the current listing's reserve
  console.log(`[agent] offer #${offer.negotiationId} — ${offer.price} HBAR — "${offer.argument?.slice(0, 80)}" (reserve ${ctx.minPrice})`);

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

  // Accepted deal: settle on-chain (capped) and publish the dramatic reveal.
  if (verdict.decision === 'accept') {
    try {
      const settleAmount = Math.min(offer.price, SETTLE_CAP_HBAR);
      const escrow = escrowClient();
      const res = await releaseEscrow(
        escrow,
        process.env.SELLER_AGENT_ACCOUNT_ID,
        settleAmount,
        offer.negotiationId
      );
      escrow.close();
      await publishMessage(client, TOPIC, {
        type: 'settlement',
        negotiationId: offer.negotiationId,
        amountHbar: settleAmount,
        negotiatedPrice: offer.price,
        txId: res.txId,
        status: res.status,
      });
      await publishMessage(client, TOPIC, {
        type: 'reveal',
        negotiationId: offer.negotiationId,
        minPrice: ctx.minPrice,
        acceptedPrice: offer.price,
      });
      console.log(`[agent] settled ${settleAmount} HBAR (cap ${SETTLE_CAP_HBAR}) — ${res.txId}`);
    } catch (err) {
      console.warn('[agent] settlement failed (verdict stands):', err.message);
    }
  }
  return verdict;
}

async function loop() {
  console.log(`[agent] seller agent ${process.env.SELLER_AGENT_ACCOUNT_ID} watching topic ${TOPIC}`);
  // Start from the tip — never replay historical negotiations after a restart.
  try {
    const res = await fetch(
      `${process.env.MIRROR_NODE_URL || 'https://testnet.mirrornode.hedera.com'}/api/v1/topics/${TOPIC}/messages?order=desc&limit=1`
    );
    const data = await res.json();
    lastSeq = data.messages?.[0]?.sequence_number ?? 0;
    console.log(`[agent] starting after sequence ${lastSeq}`);
  } catch (err) {
    console.warn('[agent] could not fetch topic tip, starting from 0:', err.message);
  }
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

process.on('SIGINT', () => {
  running = false;
  client.close();
  process.exit(0);
});
loop();
