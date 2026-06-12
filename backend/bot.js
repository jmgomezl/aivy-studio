// Kickoff Telegram bot (@cryptokickoffbot).
// Two ways to make an offer:
//   1. Mini App button (WEBAPP_URL) — the full themed experience
//   2. Plain chat fallback: "30 I deserve this coffee because..." — price + argument
// The bot publishes offers through the backend REST API and watches the
// negotiation state until the verdict lands, then replies with reasoning,
// verdict, and the spoken audio when available.
import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { existsSync } from 'node:fs';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8787';
const WEBAPP_URL = process.env.WEBAPP_URL || '';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const OFFER_RE = /^(\d+(?:\.\d+)?)\s+(.{10,})$/s;

function mainKeyboard() {
  const rows = [];
  if (WEBAPP_URL) rows.push([Markup.button.webApp('☕ Make an offer', WEBAPP_URL)]);
  return rows.length ? Markup.inlineKeyboard(rows) : undefined;
}

bot.start((ctx) =>
  ctx.reply(
    [
      '☕ *Kickoff\\.bot* — the agent\\-driven marketplace on Hedera\\.',
      '',
      'A seller agent guards this specialty coffee\\. Its minimum price is committed on\\-chain — it literally cannot change it\\.',
      '',
      'Make your offer: *price \\+ why you deserve it*\\.',
      'Example: `30 I fell in love with Huila coffee at a farm in Pitalito`',
      '',
      'The story can beat the money\\. _Tu agente negocia\\. Tú ganas\\._',
    ].join('\n'),
    { parse_mode: 'MarkdownV2', ...mainKeyboard() }
  )
);

bot.help((ctx) =>
  ctx.reply('Send: <price in HBAR> <your argument>\nExample: 30 I brew V60 every morning and a washed Huila deserves a careful hand.')
);

bot.on('text', async (ctx) => {
  const match = ctx.message.text.match(OFFER_RE);
  if (!match) {
    return ctx.reply('Format: <price> <argument>\nExample: 30 I know Huila coffee — jasmine notes, washed process. It belongs with someone who gets it.');
  }
  const price = Number(match[1]);
  const argument = match[2].trim();
  const negotiationId = `tg-${ctx.from.id}-${Date.now()}`;

  try {
    const res = await fetch(`${BACKEND}/api/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ negotiationId, price, argument, buyer: `tg:${ctx.from.username || ctx.from.id}` }),
    });
    if (!res.ok) throw new Error(`backend ${res.status}`);
    const { sequence } = await res.json();
    await ctx.reply(`📡 Offer recorded on Hedera (HCS-10 seq ${sequence}). The seller agent is evaluating...`);
  } catch (err) {
    console.error('[bot] offer failed:', err.message);
    return ctx.reply('⚠️ Could not reach the negotiation channel. Try again.');
  }

  // Watch for the verdict (agent usually answers in ~5-15 s).
  const verdict = await waitForVerdict(negotiationId, 90_000);
  if (!verdict) return ctx.reply('⏳ The agent is taking its time — check the arena screen.');

  const n = verdict;
  const p = n.sellProbability != null ? ` (sell probability ${n.sellProbability}%)` : '';
  const icon = n.verdict.decision === 'accept' ? '✅' : n.verdict.decision === 'counter' ? '🔁' : '❌';
  const lines = [
    `${icon} *Verdict: ${n.verdict.decision.toUpperCase()}*${p}`,
    '',
    `🗣 "${n.verdict.spokenVerdict}"`,
  ];
  if (n.verdict.decision === 'counter' && n.verdict.counterPrice) {
    lines.push('', `Counter-offer: *${n.verdict.counterPrice} HBAR* — answer with a new offer.`);
  }
  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });

  if (n.verdict.audio && existsSync(n.verdict.audio)) {
    await ctx.replyWithVoice({ source: n.verdict.audio });
  }
});

async function waitForVerdict(negotiationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BACKEND}/api/negotiations/${negotiationId}`);
      if (res.ok) {
        const n = await res.json();
        if (n.verdict) return n;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

console.log('[bot] launching @cryptokickoffbot (long polling)...');
bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
