// Conversational seller agent — the buyer can TALK to the agent (free text), not
// just submit one price+argument. The agent answers in character, haggles, and
// nudges toward a strong formal offer — never revealing its secret floor. This is
// the off-chain negotiation layer; the binding offer still goes on-chain via
// /api/offer. Stateless: the client sends the running history each turn.
import { scrubReserve } from '../agent/evaluate.js';

function chatSystemPrompt({ productName, currency }) {
  return `You are the Kickoff seller agent, chatting live with a potential buyer about "${productName}". You are warm, charismatic, a touch dramatic — but CONCISE (1–3 short sentences per reply).

You hold a SECRET minimum price, committed on-chain. NEVER reveal it or hint where it is — no "above/below", no numbers, no margins, no "you're close to my minimum". A real seller never shows their floor; leak it and the buyer just pays exactly that.

Converse naturally: answer questions about "${productName}", react to the buyer's story and pitch, and haggle. If they name a price, respond in character — warm if it feels worthy, push for a stronger price or a more compelling reason if it's light — without disclosing your floor. The story can beat the money: reward genuine need and real appreciation, and gently call out empty flattery or "I deserve it because I'm important". Nudge them to make a strong formal offer (a price AND why they deserve it). Currency is ${currency}. Never invent on-chain facts.`;
}

function fallbackReply(message, productName) {
  const m = String(message || '').toLowerCase();
  const p = productName || 'this item';
  if (/\b(\d+)\b/.test(m)) return `An interesting number for ${p}. Tell me the story behind it — why does it belong with you? The right reason moves me more than the figure.`;
  if (/(hi|hello|hey|hola|buenas)/.test(m)) return `Welcome! ${p} is one of a kind. Tell me — what would it mean to you? Make your case.`;
  return `I hear you. But ${p} deserves more than words — bring me a price and a reason that comes from the heart, and let's see if we shake hands on-chain.`;
}

export async function sellerChat({ message, history = [], productName = 'this item', currency = 'USD' }) {
  const safe = (t) => scrubReserve(String(t || '').trim());
  if (!process.env.OPENAI_API_KEY) return safe(fallbackReply(message, productName));

  try {
    const messages = [
      { role: 'system', content: chatSystemPrompt({ productName, currency }) },
      ...history
        .slice(-10)
        .map((h) => ({ role: h.role === 'agent' ? 'assistant' : 'user', content: String(h.text || '').slice(0, 600) })),
      { role: 'user', content: String(message).slice(0, 600) },
    ];
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: process.env.LLM_MODEL || 'gpt-4o', temperature: 0.85, max_tokens: 160, messages }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    return safe(data.choices?.[0]?.message?.content || fallbackReply(message, productName));
  } catch (err) {
    console.warn('[chat] LLM failed, using fallback:', err.message);
    return safe(fallbackReply(message, productName));
  }
}
