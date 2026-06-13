// World ID — proof-of-human gating for offers.
// "One verified human, one offer per listing" makes the story-beats-money
// mechanic sybil-resistant: a single entity can't flood the auction with bot
// offers. Proof is verified SERVER-SIDE via World's cloud verify endpoint
// (required by the bounty), then the unique nullifier is recorded.
const APP_ID = process.env.WORLD_APP_ID; // app_...
const ACTION = process.env.WORLD_ACTION || 'make-offer';

export const worldIdEnabled = !!APP_ID;

// nullifier_hash -> Set(negotiationId/listingId) it has already offered on
const offered = new Map();

/**
 * Verify a World ID proof against World's cloud endpoint.
 * @returns {Promise<{ok:boolean, nullifier?:string, detail?:string}>}
 */
export async function verifyProof({ proof, merkle_root, nullifier_hash, verification_level, signal }) {
  if (!APP_ID) return { ok: false, detail: 'WORLD_APP_ID not configured' };
  try {
    const res = await fetch(`https://developer.worldcoin.org/api/v2/verify/${APP_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nullifier_hash,
        merkle_root,
        proof,
        verification_level,
        action: ACTION,
        signal_hash: signal, // bind the proof to the offer context
      }),
    });
    if (res.ok) return { ok: true, nullifier: nullifier_hash };
    const body = await res.json().catch(() => ({}));
    return { ok: false, detail: body.detail || `verify HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

/** Enforce one offer per verified human per listing. */
export function claimOffer(nullifier, scope) {
  const seen = offered.get(nullifier) ?? new Set();
  if (seen.has(scope)) return false; // already offered on this listing
  seen.add(scope);
  offered.set(nullifier, seen);
  return true;
}

export const worldConfig = { appId: APP_ID, action: ACTION };
