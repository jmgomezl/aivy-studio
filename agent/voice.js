// ElevenLabs voice synthesis. Returns a path to an mp3, or null when no key is
// configured (the show degrades gracefully to text-only).
import { writeFileSync, mkdirSync } from 'node:fs';

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; // George

export async function speakVerdict(text, outPath = `audio/verdict-${Date.now()}.mp3`) {
  // Paused by default — voice is opt-in (set VOICE_ENABLED=true to auto-narrate
  // verdicts). Keeps ElevenLabs quota for on-demand / the future spoken-negotiation
  // feature instead of spending it on every verdict.
  if (process.env.VOICE_ENABLED !== 'true') {
    return null;
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log('[voice] ELEVENLABS_API_KEY not set — skipping audio');
    return null;
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.6 },
      }),
    }
  );
  if (!res.ok) {
    console.warn(`[voice] ElevenLabs HTTP ${res.status} — continuing without audio`);
    return null;
  }
  mkdirSync('audio', { recursive: true });
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  return outPath;
}
