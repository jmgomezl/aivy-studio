// Post-sale shipping guide — when a deal seals on-chain, the seller gets an
// Amazon-style label telling them where to ship. The buyer's address is
// synthesized (this is a demo marketplace), but DETERMINISTIC per negotiation so
// it stays stable across renders and matches on every screen.

const NAMES = [
  'Sofía Martínez', 'Mateo Rojas', 'Valentina Díaz', 'Lucas Pérez',
  'Camila Torres', 'Diego Herrera', 'Isabella Gómez', 'Tomás Castro',
];
// Coherent per-country locales so street + city + carrier always match.
const LOCALES = [
  { street: 'Av. Corrientes 1234, 4°B', city: 'Buenos Aires · AR · C1043', carrier: 'Andreani' },
  { street: 'Calle 72 #10-34', city: 'Bogotá · CO · 110221', carrier: 'Coordinadora' },
  { street: 'Rua Augusta 901, ap 52', city: 'São Paulo · BR · 01305-100', carrier: 'Correios' },
  { street: 'Av. Insurgentes Sur 567', city: 'Ciudad de México · MX · 06700', carrier: 'Estafeta' },
  { street: 'Gran Vía 28, 3ºA', city: 'Madrid · ES · 28013', carrier: 'SEUR' },
  { street: 'Av. Arequipa 4500', city: 'Lima · PE · 15046', carrier: 'Olva Courier' },
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Deterministic fake shipping guide for a sealed deal. */
export function shippingGuide({ negotiationId = '', buyer = '', itemName = '', price = 0 } = {}) {
  const seed = negotiationId || buyer || 'kickoff';
  const h = hash(seed);
  const pick = (arr, salt = 0) => arr[(h + salt) % arr.length];
  const handle = typeof buyer === 'string' && buyer.startsWith('tg:') ? `@${buyer.slice(3)}` : null;
  const locale = pick(LOCALES, 3);
  return {
    order: `#${1000 + (h % 9000)}`,
    tracking: `KCK-${String(h % 1e8).padStart(8, '0')}`,
    name: pick(NAMES),
    street: locale.street,
    city: locale.city,
    carrier: locale.carrier,
    eta: '3–5 días hábiles',
    handle,
    itemName: itemName || 'Item',
    price,
  };
}
