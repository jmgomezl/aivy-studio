// World ID 4.0 — proof-of-human gating for offers.
// 4-party flow: client (IDKit) ↔ our backend (signs RP requests + verifies
// proofs) ↔ World App ↔ Developer Portal. "One verified human, one offer per
// listing" makes the story-beats-money mechanic sybil-resistant.
//
// Backend responsibilities:
//   1. /rp-signature — sign a proof request with our RP signing key (secret)
//   2. /verify       — forward the proof to POST /api/v4/verify/{rp_id}, then
//                      enforce nullifier uniqueness
import { signRequest } from '@worldcoin/idkit-core/signing';

const APP_ID = process.env.WORLD_APP_ID;          // app_...
const RP_ID = process.env.WORLD_RP_ID;            // rp_...
const SIGNING_KEY = process.env.RP_SIGNING_KEY;   // 32-byte hex (secret)
const ACTION = process.env.WORLD_ACTION || 'make-offer';

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
