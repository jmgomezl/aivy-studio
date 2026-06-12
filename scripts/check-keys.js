// Verifies the three external APIs: OpenAI (LLM evaluation), ElevenLabs (voice), Telegram (bot)
import 'dotenv/config';
import { evaluateOffer } from '../agent/evaluate.js';
import { speakVerdict } from '../agent/voice.js';

// 1. OpenAI — real evaluation through GPT-4o
const verdict = await evaluateOffer(
  { negotiationId: 'key-check', buyer: 'tester', price: 30, argument: 'I have brewed coffee from Huila on a V60 every morning for three years. The jasmine and caramel notes of a washed lot like this deserve a careful hand, and mine are.' },
  { minPrice: 25, productName: 'Specialty Coffee — Huila Single Origin', currency: 'HBAR', history: [] }
);
console.log('OpenAI:', verdict.source === 'llm' ? 'OK' : 'FALLBACK USED', '— decision:', verdict.decision, 'p =', verdict.sellProbability);
console.log('  spoken verdict:', verdict.spokenVerdict?.slice(0, 140));

// 2. ElevenLabs — synthesize that verdict
const audio = await speakVerdict(verdict.spokenVerdict, 'audio/key-check.mp3');
console.log('ElevenLabs:', audio ? `OK — ${audio}` : 'FAILED');

// 3. Telegram — getMe
const tg = await (await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`)).json();
console.log('Telegram:', tg.ok ? `OK — @${tg.result.username}` : `FAILED: ${tg.description}`);
