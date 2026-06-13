// Living marketplace grid for the landing — the "eBay of agents" feel.
// Real seller listings (from /api/listings, on-chain) are featured; simulated
// people/agent listings provide ambient market activity, with a green animated
// NEW badge as fresh items arrive.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SIMULATED = [
  { emoji: '🎟️', name: 'World Cup Ticket · Col vs Mar', seller: 'Agent ALEX', price: 340, tag: 'analytical' },
  { emoji: '💻', name: 'MacBook Pro M4 — 16GB', seller: 'Agent MAX', price: 820, tag: 'negotiator' },
  { emoji: '🎧', name: 'AirPods Max — Space Gray', seller: 'Agent SARA', price: 18, tag: 'charming' },
  { emoji: '👟', name: 'Nike Dunk Low — Panda', seller: 'maria.eth', price: 24, tag: 'human' },
  { emoji: '📷', name: 'Fujifilm X100VI', seller: 'Agent LENA', price: 410, tag: 'stubborn' },
  { emoji: '🎮', name: 'PS5 Slim + 2 games', seller: 'diego_b', price: 95, tag: 'human' },
  { emoji: '⌚', name: 'Apple Watch Ultra 2', seller: 'Agent ZAI', price: 130, tag: 'fast' },
  { emoji: '🪑', name: 'Herman Miller Aeron', seller: 'studio_nyc', price: 280, tag: 'human' },
];

const tagColor = {
  analytical: 'var(--yellow)', negotiator: 'var(--accent)', charming: 'var(--purple-light)',
  human: 'var(--blue)', stubborn: 'var(--red)', fast: 'var(--cyan)',
};

export default function Marketplace() {
  const { t, i18n } = useTranslation();
  const es = i18n.language === 'es';
  const [items, setItems] = useState([]);
  const [newId, setNewId] = useState(null);

  // Seed with real listings + a rotating slice of simulated ones.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/listings')
      .then((r) => r.json())
      .then(({ listings, active }) => {
        if (cancelled) return;
        const activeId = active?.id;
        const real = (listings || []).map((l) => ({
          id: l.id, emoji: '🏷️', name: l.name, seller: l.seller, price: null,
          tag: 'negotiator', real: true, active: l.id === activeId, onChain: l.onChain, photoUrl: l.photoUrl,
        }));
        setItems([...real, ...SIMULATED.map((s, i) => ({ ...s, id: `sim-${i}` }))]);
      })
      .catch(() => setItems(SIMULATED.map((s, i) => ({ ...s, id: `sim-${i}` }))));
    return () => { cancelled = true; };
  }, []);

  // Simulate a new listing arriving every few seconds (ambient liveliness).
  useEffect(() => {
    const iv = setInterval(() => {
      const s = SIMULATED[Math.floor(Math.random() * SIMULATED.length)];
      const id = `new-${Date.now()}`;
      setItems((prev) => [{ ...s, id, justNow: true }, ...prev].slice(0, 12));
      setNewId(id);
      setTimeout(() => setNewId(null), 4000);
    }, 6500);
    return () => clearInterval(iv);
  }, []);

  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em' }}>
            {es ? 'Marketplace' : 'Marketplace'} <span style={{ color: 'var(--accent)' }}>{es ? 'en vivo' : 'live'}</span>
          </h2>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            {es ? 'Personas y agentes ofreciendo ahora mismo' : 'People and agents offering right now'}
          </div>
        </div>
        <a href="/sell" className="btn-primary">{es ? '+ Vender' : '+ Sell'}</a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {items.map((it) => (
          <div key={it.id} className="mkt-card" style={it.id === newId ? { animation: 'mktPop .5s ease' } : undefined}>
            {(it.id === newId || it.justNow) && <span className="mkt-new">● {es ? 'NUEVO' : 'NEW'}</span>}
            {it.real && it.onChain && <span className="mkt-onchain">🔒 on-chain</span>}
            <div className="mkt-thumb">
              {it.photoUrl ? <img src={it.photoUrl} alt="" /> : <span style={{ fontSize: 30 }}>{it.emoji}</span>}
            </div>
            <div className="mkt-name">{it.name}</div>
            <div className="mkt-meta">
              <span className="mkt-dot" style={{ background: tagColor[it.tag] || 'var(--muted)' }} />
              {it.seller}
            </div>
            <div className="mkt-foot">
              <span className="mkt-price">{it.price != null ? `${it.price} HBAR` : (es ? 'Reserva oculta' : 'Hidden reserve')}</span>
              {it.real && it.active
                ? <a href="/offer" className="mkt-bid">{es ? 'Ofertar' : 'Bid'}</a>
                : it.real
                ? <span className="mkt-bid" style={{ opacity: 0.5, cursor: 'default' }}>{es ? 'Cerrado' : 'Closed'}</span>
                : <a href="/arena" className="mkt-bid">{es ? 'Ver' : 'Watch'}</a>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
