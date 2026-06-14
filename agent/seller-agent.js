// Kickoff seller agent engine.
// Polls the HCS-10 negotiation topic via Mirror Node, evaluates each new offer
// (price + argument), publishes its reasoning and verdict back to the topic,
// and speaks the verdict via ElevenLabs. Audio is generated BEFORE any on-chain
// settlement so the voice plays while the transaction confirms.
import 'dotenv/config';
import { evaluateOffer } from './evaluate.js';
import { speakVerdict } from './voice.js';
import { agentClient, fetchTopicMessages, publishMessage } from './hedera.js';
import { escrowClient } from './escrow.js';
import { settleDeal } from './delegation.js';
import { crossAssetSettle, crossAssetSettleEnabled } from './uniswap-settle.js';
import { insureDeal, insuranceEnabled } from './insurance.js';
import { lockEscrowEvm, releaseEscrowEvm, refundEscrowEvm, escrowEnabled } from './escrow-evm.js';
import { payRealKusd, kusdPaymentEnabled } from './payment-kusd.js';

// Testnet-budget guard: the on-chain settlement moves a symbolic amount no
// matter what price was negotiated, so demos can't drain the faucet balance.
const SETTLE_CAP_HBAR = Number(process.env.DEMO_SETTLE_HBAR || 1);

const TOPIC = process.env.HCS10_NEGOTIATION_TOPIC;
const POLL_MS = Number(process.env.AGENT_POLL_MS || 2500);

import { existsSync, readFileSync } from 'node:fs';

const RESERVES_FILE = 'data/reserves.json';
const ACTIVE_FILE = 'data/active-listing.json';

// Env defaults — the floor every defend context inherits when no listing matches.
const DEFAULTS = {
  productName: process.env.PRODUCT_NAME || 'this item',
  currency: 'USD',
  minPrice: Number(process.env.SELLER_MIN_PRICE_HBAR || 25),
  sellerWalletEvm: null,
  payoutToken: 'KUSD',
};

// Per-listing negotiation history (keyed by listingId; '_' for the legacy path) —
// so concurrent negotiations on different products never bleed context.
const histories = new Map();
function historyFor(listingId) {
  const k = listingId || '_';
  if (!histories.has(k)) histories.set(k, []);
  return histories.get(k);
}

function readJson(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; }
}

// Resolve the defend context for an offer. Multi-product: look the listing's
// SECRET reserve up by id from the server-written reserves file. Falls back to
// the legacy single active-listing file, then the env default (back-compat).
function resolveDefend(offer) {
  const listingId = offer.listingId || null;
  if (listingId) {
    const reserves = readJson(RESERVES_FILE) || {};
    const r = reserves[listingId];
    if (r?.minPriceHbar) {
      return {
        listingId,
        currency: 'USD',
        minPrice: Number(r.minPriceHbar),
        productName: r.name || DEFAULTS.productName,
        sellerWalletEvm: r.sellerWalletEvm || null,
        payoutToken: r.payoutToken || 'KUSD',
        status: r.status || 'live',
        history: historyFor(listingId),
      };
    }
  }
  // Legacy fallback: the single active listing the old flow defended.
  const a = readJson(ACTIVE_FILE);
  if (a?.minPriceHbar) {
    return {
      listingId: a.id || listingId,
      currency: 'USD',
      minPrice: Number(a.minPriceHbar),
      productName: a.name || DEFAULTS.productName,
      sellerWalletEvm: a.sellerWalletEvm || null,
      payoutToken: a.payoutToken || 'KUSD',
      status: 'live',
      history: historyFor(a.id || listingId),
    };
  }
  return { ...DEFAULTS, listingId, status: 'live', history: historyFor(listingId) };
}

const client = agentClient();
let lastSeq = 0;
let running = true;

export async function handleOffer(offer) {
  // Resolve THIS offer's listing reserve (local — never mutate shared state, so
  // concurrent negotiations on different products stay isolated).
  const ctx = resolveDefend(offer);
  console.log(`[agent] offer #${offer.negotiationId} [${ctx.listingId || 'legacy'}] — ${offer.price} USD — "${offer.argument?.slice(0, 80)}" (reserve ${ctx.minPrice} USD)`);

  // Guard: never negotiate a sold listing — publish a clean, non-leaking decline.
  if (ctx.status === 'sold') {
    await publishMessage(client, TOPIC, {
      type: 'agent_verdict',
      negotiationId: offer.negotiationId,
      decision: 'reject',
      counterPrice: null,
      spokenVerdict: `${ctx.productName} has already been sold. This item is no longer available.`,
    });
    console.log(`[agent] offer on SOLD listing ${ctx.listingId} — declined`);
    return { decision: 'reject', sold: true };
  }

  await publishMessage(client, TOPIC, {
    type: 'agent_status',
    negotiationId: offer.negotiationId,
    status: 'evaluating',
  });

  // Optional buyer-funded escrow: lock the (capped) offer amount on-chain BEFORE
  // the agent decides, so "locked" lands ahead of the verdict. Operator-funded on
  // the buyer's behalf for the demo (the managed wallet is identity-only today).
  let escrowLock = null;
  if (offer.escrow && escrowEnabled()) {
    escrowLock = await lockEscrowEvm(client, TOPIC, {
      negotiationId: offer.negotiationId,
      buyerAddress: offer.buyerAddress,
      amountHbar: offer.price,
    });
  }

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
      // Settle via a Hedera Scheduled Transaction (escrow → seller). Autonomous
      // below the Ledger threshold (auto-executes); above it the schedule stays
      // pending for a hardware co-sign.
      const res = await settleDeal(escrow, {
        from: process.env.HEDERA_OPERATOR_ID,
        to: process.env.SELLER_AGENT_ACCOUNT_ID,
        amountHbar: settleAmount,
        negotiationId: offer.negotiationId,
      });
      escrow.close();
      await publishMessage(client, TOPIC, {
        type: 'settlement',
        negotiationId: offer.negotiationId,
        amountHbar: settleAmount,
        negotiatedPrice: offer.price,
        scheduleId: res.scheduleId,
        scheduledTxId: res.scheduledTxId,
        mode: res.mode,
      });
      await publishMessage(client, TOPIC, {
        type: 'reveal',
        negotiationId: offer.negotiationId,
        ...(ctx.listingId ? { listingId: ctx.listingId } : {}),
        minPrice: ctx.minPrice,
        acceptedPrice: offer.price,
      });
      console.log(`[agent] settled ${settleAmount} HBAR (symbolic cap; deal was ${offer.price} USD) via scheduled tx (${res.mode}) — schedule ${res.scheduleId}`);

      // Cross-asset leg: convert proceeds to the seller's preferred token via
      // Uniswap (best-effort, async — the EVM swap takes ~20s and must not block
      // the negotiation loop). Records the swap back on HCS-10.
      // Only when the seller chose a non-default payout token (opt-in) — keeps the
      // real Sepolia swap budget for deals that actually want cross-asset payout.
      if (crossAssetSettleEnabled() && ctx.payoutToken && ctx.payoutToken !== 'KUSD') {
        void crossAssetSettle(client, TOPIC, { negotiationId: offer.negotiationId, preferredSymbol: ctx.payoutToken });
      }

      // Optional package insurance — buy the policy on-chain if the buyer opted in.
      if (offer.insured && insuranceEnabled()) {
        void insureDeal(client, TOPIC, { negotiationId: offer.negotiationId, coverageHbar: offer.price });
      }

      // Optional escrow: deal accepted → release the locked funds to the seller.
      if (escrowLock) {
        void releaseEscrowEvm(client, TOPIC, { negotiationId: offer.negotiationId, amountHbar: escrowLock.amount });
      }

      // Real buyer-funded settlement: move the negotiated amount in KUSD from the
      // buyer's funded wallet → the seller's. Fires only when both are funded
      // managed wallets; otherwise skips quietly (the capped HBAR settle stands).
      if (kusdPaymentEnabled()) {
        void payRealKusd(client, TOPIC, {
          negotiationId: offer.negotiationId,
          buyerAddress: offer.buyerAddress,
          sellerWalletEvm: ctx.sellerWalletEvm,
          amountUsd: offer.price,
        });
      }
    } catch (err) {
      console.warn('[agent] settlement failed (verdict stands):', err.message);
    }
  } else if (verdict.decision === 'reject' && escrowLock) {
    // Optional escrow: deal rejected → refund the locked funds to the buyer.
    void refundEscrowEvm(client, TOPIC, { negotiationId: offer.negotiationId, amountHbar: escrowLock.amount });
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
            listingId: m.json.listingId ?? null,
            buyer: m.json.buyer,
            price: Number(m.json.price),
            argument: m.json.argument,
            insured: !!m.json.insured,
            escrow: !!m.json.escrow,
            buyerAddress: m.json.buyerAddress,
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
