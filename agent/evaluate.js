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
  const aboveMinimum = offer.price >= ctx.minPrice;
  if (process.env.OPENAI_API_KEY) {
    try {
      return { ...(await llmEvaluate(offer, ctx, aboveMinimum)), source: 'llm' };
    } catch (err) {
      console.warn('[evaluate] LLM failed, using deterministic fallback:', err.message);
    }
  }
  return { ...deterministicEvaluate(offer, ctx, aboveMinimum), source: 'fallback' };
}

async function llmEvaluate(offer, ctx, aboveMinimum) {
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
              aboveMinimum,
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
  // Hard guardrail: the LLM can never accept below the committed minimum.
  if (!aboveMinimum && out.decision === 'accept') {
    out.decision = 'reject';
    out.reasoning += ' [guardrail: offer below committed minimum — accept overridden]';
  }
  return out;
}

export function deterministicEvaluate(offer, ctx, aboveMinimum) {
  const arg = offer.argument || '';
  const authority = AUTHORITY_PATTERNS.test(arg);
  const passion = PASSION_PATTERNS.test(arg);
  const margin = (offer.price - ctx.minPrice) / ctx.minPrice;

  let p = aboveMinimum ? 55 + Math.min(30, Math.round(margin * 100)) : 15;
  if (passion) p += 15;
  if (authority) p -= 25;
  if (arg.length > 120) p += 5;
  p = Math.max(2, Math.min(98, p));

  if (!aboveMinimum) {
    return {
      decision: 'reject',
      counterPrice: null,
      sellProbability: p,
      reasoning: `Offer of ${offer.price} ${ctx.currency} is below my committed minimum. ${
        passion ? 'The argument shows real coffee knowledge — I want to keep talking.' : ''
      }${authority ? ' Authority arguments do not move me.' : ''}`,
      spokenVerdict: passion
        ? 'I can hear that you truly love coffee — but my hands are tied below my committed price. Come back with a little more and this cup is yours.'
        : 'I respect the offer, but it does not honor what this coffee is worth. Raise it, and bring me a reason that comes from the heart.',
    };
  }
  const accept = p >= 60;
  return {
    decision: accept ? 'accept' : 'counter',
    counterPrice: accept ? null : Math.ceil(offer.price * 1.15),
    sellProbability: p,
    reasoning: `Offer clears the committed minimum (margin ${(margin * 100).toFixed(0)}%). ${
      passion ? 'Genuine specialty-coffee appreciation detected.' : 'Argument is generic.'
    }${authority ? ' Authority argument penalized.' : ''}`,
    spokenVerdict: accept
      ? 'You spoke to the soul of this coffee, and the price honors it. Deal — the coffee is yours, sealed on Hedera.'
      : 'You are close — the passion is there, but this coffee deserves a touch more. Meet my counter and we shake hands on-chain.',
  };
}
