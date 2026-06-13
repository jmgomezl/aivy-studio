// Offer evaluation — LLM-backed with a deterministic fallback so a live demo
// always resolves (lesson from the prior build). Model-agnostic: any
// OpenAI-compatible chat endpoint works.
import { SELLER_SYSTEM_PROMPT } from './personality.js';

const AUTHORITY_PATTERNS =
  /\b(judge|juez|important|importante|deserve it because i am|soy el|i'?m the)\b/i;
const PASSION_PATTERNS =
  /\b(origin|origen|roast|tueste|brew|filtrado|v60|chemex|aeropress|geisha|bourbon|honey|natural|finca|farm|aroma|notas|notes|cata|specialty|especialidad)\b/i;

/**
 * @param {object} offer { negotiationId, buyer, price, argument }
 * @param {object} ctx   { minPrice, productName, currency, history }
 * @returns {Promise<{decision, counterPrice, sellProbability, reasoning, spokenVerdict, source}>}
 */
export async function evaluateOffer(offer, ctx) {
  const meetsReserve = offer.price >= ctx.minPrice;
  let out;
  if (process.env.OPENAI_API_KEY) {
    try {
      out = { ...(await llmEvaluate(offer, ctx, meetsReserve)), source: 'llm' };
    } catch (err) {
      console.warn('[evaluate] LLM failed, using deterministic fallback:', err.message);
    }
  }
  if (!out) out = { ...deterministicEvaluate(offer, ctx, meetsReserve), source: 'fallback' };

  // Final safety net: nothing published may disclose or imply the secret floor,
  // even if the LLM disobeys the prompt. Both fields go on-chain + on the feed.
  out.reasoning = scrubReserve(out.reasoning);
  out.spokenVerdict = scrubReserve(out.spokenVerdict);
  return out;
}

// Strip any phrasing that would betray the committed minimum (the whole point of
// commit-reveal is that the buyer never learns it until the deal closes).
export function scrubReserve(text) {
  if (!text) return text;
  let t = String(text);
  t = t.replace(/\s*\(\s*(?:profit\s+)?margin[^)]*\)/gi, ''); // "(margin 20%)"
  t = t.replace(/\b(?:sits?|is|falls?|comes? in|lands?)?\s*(?:well\s+|just\s+|comfortably\s+)?above\s+(?:the|my|your)?\s*(?:committed\s+|secret\s+|on-chain\s+)?(?:minimum|reserve|floor|price|threshold)\b/gi, 'is in range');
  t = t.replace(/\b(?:sits?|is|falls?|comes? in|lands?)?\s*(?:well\s+|just\s+|comfortably\s+)?below\s+(?:the|my|your)?\s*(?:committed\s+|secret\s+|on-chain\s+)?(?:minimum|reserve|floor|price|threshold)\b/gi, "isn't quite there yet");
  t = t.replace(/\b(?:clears?|meets?|misses?|reaches?|exceeds?|hits?)\s+(?:the|my|your)?\s*(?:committed\s+|secret\s+|on-chain\s+)?(?:minimum|reserve|floor|threshold)\b/gi, 'feels right');
  t = t.replace(/\b(?:committed|secret|on-chain)\s+(?:minimum|reserve|price|floor)\b/gi, 'asking range');
  t = t.replace(/\b(?:minimum|reserve|floor)\s+price\b/gi, 'asking range');
  // Backstop: neutralize any tell-tale word that survived the targeted passes.
  t = t.replace(/\b(minimum|reserve|floor|threshold|margin)\b/gi, 'price');
  return t.replace(/\s{2,}/g, ' ').trim();
}

async function llmEvaluate(offer, ctx, meetsReserve) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'gpt-4o',
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: SELLER_SYSTEM_PROMPT({
            productName: ctx.productName,
            currency: ctx.currency,
          }),
        },
        {
          role: 'user',
          content: JSON.stringify({
            offer: {
              price: offer.price,
              currency: ctx.currency,
              argument: offer.argument,
              meetsReserve,
            },
            negotiationHistory: ctx.history ?? [],
          }),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const out = JSON.parse(data.choices[0].message.content);
  // Hard guardrail: the LLM can never accept below the committed minimum. If it
  // tries, fall back to a clean reject (don't keep the accept-flavoured prose,
  // and don't leak why) — keep the model's felt probability.
  if (!meetsReserve && out.decision === 'accept') {
    console.warn('[evaluate] guardrail: LLM accepted below reserve — overridden to reject');
    return { ...deterministicEvaluate(offer, ctx, false), sellProbability: out.sellProbability ?? 15 };
  }
  return out;
}

export function deterministicEvaluate(offer, ctx, meetsReserve) {
  const arg = offer.argument || '';
  const authority = AUTHORITY_PATTERNS.test(arg);
  const passion = PASSION_PATTERNS.test(arg);
  const margin = (offer.price - ctx.minPrice) / ctx.minPrice;

  // margin stays internal (it reveals the floor) — used only to weight probability.
  let p = meetsReserve ? 55 + Math.min(30, Math.round(margin * 100)) : 15;
  if (passion) p += 15;
  if (authority) p -= 25;
  if (arg.length > 120) p += 5;
  p = Math.max(2, Math.min(98, p));

  const product = ctx.productName || 'this item';
  if (!meetsReserve) {
    return {
      decision: 'reject',
      counterPrice: null,
      sellProbability: p,
      reasoning: `The price isn't quite where it needs to be yet.${
        passion ? ' The story shows real appreciation — worth continuing.' : ''
      }${authority ? ' Authority arguments do not move me.' : ''}`,
      spokenVerdict: passion
        ? `I can hear how much ${product} means to you — but the number isn't there yet. Come back a little stronger and it's yours.`
        : `I respect the offer, but it doesn't yet honor what ${product} is worth. Raise it, and bring me a reason that comes from the heart.`,
    };
  }
  const accept = p >= 60;
  return {
    decision: accept ? 'accept' : 'counter',
    counterPrice: accept ? null : Math.ceil(offer.price * 1.15),
    sellProbability: p,
    reasoning: accept
      ? `The price feels fair and the story lands${passion ? ' with genuine appreciation' : ''} — I'm ready to deal.${authority ? ' (Authority angle ignored.)' : ''}`
      : `The price is workable, but the story is ${passion ? 'genuine yet thin' : 'still generic'} — I'd want a touch more to part with ${product}.${authority ? ' Authority argument penalized.' : ''}`,
    spokenVerdict: accept
      ? `You spoke to the heart of ${product}, and the price honors it. Deal — it is yours, sealed on Hedera.`
      : `You are close — the conviction is there, but ${product} deserves a touch more. Meet my counter and we shake hands on-chain.`,
  };
}
