// Reputation — eBay / MercadoLibre style trust signals, computed from REAL data:
//  - seller side: listings created + sold + HBAR volume (from listings.js)
//  - buyer side:  offers made + deals won (from the live negotiation state)
// Keyed by identity string (tg:<username> is the persistent one; web-/anonymous/
// agent:* are transient). Tiers derive from completed-deal count — honest, no
// fabricated review scores.

const TIER = (deals) => (deals >= 15 ? 'gold' : deals >= 5 ? 'silver' : deals >= 1 ? 'bronze' : 'new');

export function computeReputation(listings = [], negotiations = {}) {
  const rep = {};
  const ensure = (id) =>
    (rep[id] ??= { id, sales: 0, buys: 0, listings: 0, offers: 0, volumeHbar: 0 });

  // Seller side — from listings.
  for (const l of listings) {
    const s = ensure(l.seller || 'anonymous');
    s.listings++;
    if (l.status === 'sold') {
      s.sales++;
      s.volumeHbar += Number(l.soldPrice) || 0;
    }
  }

  // Buyer side — from negotiations. The accepted offer is the winner.
  for (const n of Object.values(negotiations)) {
    const offers = n.offers || [];
    for (const o of offers) ensure(o.buyer || 'anonymous').offers++;
    if (n.verdict?.decision === 'accept' && offers.length) {
      const winner = offers.reduce((a, b) => ((b.sequence || 0) > (a.sequence || 0) ? b : a), offers[0]);
      const w = ensure(winner.buyer || 'anonymous');
      w.buys++;
      w.volumeHbar += Number(winner.price) || 0;
    }
  }

  for (const id in rep) {
    const r = rep[id];
    r.deals = r.sales + r.buys;
    r.tier = TIER(r.deals);
  }
  return rep;
}

export function reputationFor(listings, negotiations, id) {
  const rep = computeReputation(listings, negotiations);
  return rep[id] || { id, sales: 0, buys: 0, listings: 0, offers: 0, volumeHbar: 0, deals: 0, tier: 'new' };
}
