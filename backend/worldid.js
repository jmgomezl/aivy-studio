// World ID 4.0 — proof-of-human gating for offers.
// 4-party flow: client (IDKit) ↔ our backend (signs RP requests + verifies
// proofs) ↔ World App ↔ Developer Portal. "One verified human, one offer per
// listing" makes the story-beats-money mechanic sybil-resistant.
//
// Backend responsibilities:
//   1. /rp-signature — sign a proof request with our RP signing key (secret)
//   2. /verify       — forward the proof to POST /api/v4/verify/{rp_id}, then
//                      enforce nullifier uniqueness
import crypto from 'node:crypto';
import { signRequest } from '@worldcoin/idkit-core/signing';

const APP_ID = process.env.WORLD_APP_ID;          // app_...
const RP_ID = process.env.WORLD_RP_ID;            // rp_...
const SIGNING_KEY = process.env.RP_SIGNING_KEY;   // 32-byte hex (secret)
const ACTION = process.env.WORLD_ACTION || 'make-offer';

// Secret for the short-lived proof-of-human token (binds a verified nullifier to
// a scope so the OFFER endpoint can enforce personhood SERVER-SIDE).
const TOKEN_SECRET = SIGNING_KEY || process.env.SESSION_SECRET || 'kickoff-world-dev';
const TOKEN_TTL_MS = 30 * 60 * 1000; // verify, then offer

/** Mint a signed proof-of-human token after a successful World ID verification. */
export function issueWorldToken(nullifier, scope) {
  const body = Buffer.from(JSON.stringify({ nullifier, scope: scope ?? null, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify a proof-of-human token (optionally bound to scope). Returns {nullifier} or null. */
export function verifyWorldToken(token, scope) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!d.exp || d.exp < Date.now()) return null;
    if (scope && d.scope && d.scope !== scope) return null;
    return { nullifier: d.nullifier };
  } catch {
    return null;
  }
}

export const worldIdEnabled = !!(APP_ID && RP_ID && SIGNING_KEY);
export const worldConfig = { appId: APP_ID, rpId: RP_ID, action: ACTION };

// nullifier -> Set(scope) it has already offered on (sybil resistance)
const offered = new Map();

/** Produce an RP signature for a proof request (never expose the signing key). */
export function rpSignature(action = ACTION) {
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: SIGNING_KEY, action });
  return { sig, nonce, created_at: createdAt, expires_at: expiresAt };
}

/**
 * Verify an IDKit 4.0 response against the Developer Portal, then enforce
 * one-offer-per-human-per-scope.
 * @returns {Promise<{ok:boolean, nullifier?:string, detail?:string}>}
 */
export async function verifyProof(idkitResponse, scope) {
  if (!worldIdEnabled) return { ok: false, detail: 'World ID not configured' };
  try {
    const res = await fetch(`https://developer.world.org/api/v4/verify/${RP_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(idkitResponse),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, detail: `verify ${res.status}: ${body.slice(0, 160)}` };
    }
    // nullifier(s) live in the response payload
    const nullifier = idkitResponse?.responses?.[0]?.nullifier;
    if (!nullifier) return { ok: false, detail: 'no nullifier in response' };

    if (scope) {
      const seen = offered.get(nullifier) ?? new Set();
      if (seen.has(scope)) return { ok: false, detail: 'this human already offered on this item' };
      seen.add(scope);
      offered.set(nullifier, seen);
    }
    return { ok: true, nullifier };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}
