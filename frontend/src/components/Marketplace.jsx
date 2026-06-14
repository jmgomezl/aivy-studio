// Living marketplace grid for the landing — the "eBay of agents" feel.
// Real seller listings (from /api/listings, on-chain) are featured; simulated
// people/agent listings provide ambient market activity, with a green animated
// NEW badge as fresh items arrive.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../lib/asset.js';
import { tierOf } from '../lib/reputation.js';

const SIMULATED = [
  { emoji: '🎟️', name: 'World Cup Ticket · Col vs Mar', seller: 'Agent ALEX', price: 340, tag: 'analytical', cat: 'Tickets' },
  { emoji: '💻', name: 'MacBook Pro M4 — 16GB', seller: 'Agent MAX', price: 820, tag: 'negotiator', cat: 'Electronics' },
  { emoji: '🎧', name: 'AirPods Max — Space Gray', seller: 'Agent SARA', price: 18, tag: 'charming', cat: 'Electronics' },
  { emoji: '👟', name: 'Nike Dunk Low — Panda', seller: 'maria.eth', price: 24, tag: 'human', cat: 'Fashion' },
  { emoji: '📷', name: 'Fujifilm X100VI', seller: 'Agent LENA', price: 410, tag: 'stubborn', cat: 'Electronics' },
  { emoji: '🎮', name: 'PS5 Slim + 2 games', seller: 'diego_b', price: 95, tag: 'human', cat: 'Electronics' },
  { emoji: '⌚', name: 'Apple Watch Ultra 2', seller: 'Agent ZAI', price: 130, tag: 'fast', cat: 'Electronics' },
  { emoji: '🪑', name: 'Herman Miller Aeron', seller: 'studio_nyc', price: 280, tag: 'human', cat: 'Home' },
];

const CATEGORIES = ['All', 'Electronics', 'Fashion', 'Home', 'Tickets', 'Collectibles', 'Other'];

const tagColor = {
  analytical: 'var(--yellow)', negotiator: 'var(--accent)', charming: 'var(--purple-light)',
  human: 'var(--blue)', stubborn: 'var(--red)', fast: 'var(--cyan)',
};

export default function Marketplace() {
  const { t, i18n } = useTranslation();
  const es = i18n.language === 'es';
  const [items, setItems] = useState([]);
  const [newId, setNewId] = useState(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');
  const [reps, setReps] = useState({});

  useEffect(() => {
    fetch('/api/reputation').then((r) => r.json()).then((d) => setReps(d.reputation || {})).catch(() => {});
  }, []);

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
          status: l.status, soldPrice: l.soldPrice, cat: l.category || 'Other',
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

      {/* search + category filter */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="mkt-search"
          placeholder={es ? '🔍 Buscar productos…' : '🔍 Search products…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => (
            <button key={c} className={`mkt-chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
              {c === 'All' ? (es ? 'Todo' : 'All') : c}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {items
          .filter((it) => cat === 'All' || it.cat === cat)
          .filter((it) => !query.trim() || it.name.toLowerCase().includes(query.trim().toLowerCase()))
          .map((it) => (
          <div key={it.id} className="mkt-card" style={it.id === newId ? { animation: 'mktPop .5s ease' } : undefined}>
            {it.status === 'sold' && <span className="mkt-sold-badge">✓ {es ? 'VENDIDO' : 'SOLD'}</span>}
            {it.status !== 'sold' && (it.id === newId || it.justNow) && <span className="mkt-new">● {es ? 'NUEVO' : 'NEW'}</span>}
            {it.real && it.onChain && it.status !== 'sold' && <span className="mkt-onchain">🔒 on-chain</span>}
            <div className="mkt-thumb">
              {it.photoUrl ? <img src={assetUrl(it.photoUrl)} alt="" /> : <span style={{ fontSize: 30 }}>{it.emoji}</span>}
            </div>
            <div className="mkt-name">{it.name}</div>
            <div className="mkt-meta">
              <span className="mkt-dot" style={{ background: tagColor[it.tag] || 'var(--muted)' }} />
              {it.seller}
              {it.real && reps[it.seller] && (reps[it.seller].sales > 0 || reps[it.seller].listings > 1) && (
                <span className="mkt-rep" style={{ color: tierOf(reps[it.seller]).color }} title={`${reps[it.seller].sales} ${es ? 'ventas' : 'sales'}`}>
                  {tierOf(reps[it.seller]).icon} {reps[it.seller].sales}
                </span>
              )}
            </div>
            <div className="mkt-foot">
              <span className="mkt-price">
                {it.status === 'sold'
                  ? `${it.soldPrice} USD`
                  : it.price != null ? `${it.price} USD` : (es ? 'Reserva oculta' : 'Hidden reserve')}
              </span>
              {it.status === 'sold'
                ? <span className="mkt-bid" style={{ color: 'var(--accent)', borderColor: 'rgba(0,255,135,.3)', cursor: 'default' }}>✓ {es ? 'Vendido' : 'Sold'}</span>
                : it.real && it.active
                ? <a href="/offer" className="mkt-bid">{es ? 'Ofertar' : 'Bid'}</a>
                : it.real
                ? <span className="mkt-bid" style={{ opacity: 0.5, cursor: 'default' }}>{es ? 'Finalizado' : 'Ended'}</span>
                : <a href="/arena" className="mkt-bid">{es ? 'Ver' : 'Watch'}</a>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
