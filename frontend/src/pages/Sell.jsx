// Seller listing flow — the OTHER side of the marketplace.
// A seller (second phone / second Telegram account) snaps a photo, writes a
// description, and sets a SECRET reserve price that gets committed on-chain
// (keccak256(reserve, salt)). The reserve drives the negotiation and the
// dramatic reveal — nobody, not even the buyer's agent, sees it until the deal.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toggleLang } from '../i18n';

export default function Sell() {
  const { t, i18n } = useTranslation();
  const [photo, setPhoto] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [status, setStatus] = useState(null); // null | 'sending' | listing | 'error'
  const [result, setResult] = useState(null);

  const es = i18n.language === 'es';
  const tg = window.Telegram?.WebApp;

  function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  }

  async function submit() {
    const p = Number(price);
    if (!name.trim() || !p || p < 1) {
      setStatus('error');
      return;
    }
    setStatus('sending');
    tg?.HapticFeedback?.impactOccurred?.('medium');
    try {
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          minPriceHbar: p,
          photoDataUrl: photo,
          seller: tg?.initDataUnsafe?.user ? `tg:${tg.initDataUnsafe.user.username || tg.initDataUnsafe.user.id}` : 'web-seller',
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const { listing } = await res.json();
      setResult(listing);
      setStatus('listing');
    } catch {
      setStatus('error');
    }
  }

  if (result) {
    return (
      <div className="miniapp" style={{ minHeight: '100vh' }}>
        <div className="nav" style={{ height: 48 }}>
          <a className="logo" href="/" style={{ fontSize: 15 }}><div className="logo-dot" />kickoff<span>.bot</span></a>
        </div>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>{result.onChain ? '🔒' : '📋'}</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
            {es ? 'Producto listado' : 'Product listed'}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, maxWidth: 320, margin: '0 auto 16px' }}>
            {es
              ? 'Tu precio mínimo está comprometido on-chain. Nadie puede verlo — se revelará solo cuando se cierre el trato.'
              : 'Your minimum price is committed on-chain. Nobody can see it — it reveals only when the deal closes.'}
          </div>
          {result.onChain && (
            <a
              className="verdict-tx"
              href={`https://hashscan.io/testnet/transaction/${result.commitmentTx}`}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-block', marginBottom: 16 }}
            >
              {es ? 'Ver compromiso en Hashscan ↗' : 'View commitment on Hashscan ↗'}
            </a>
          )}
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', wordBreak: 'break-all', marginBottom: 20 }}>
            {result.commitHash}
          </div>
          <a className="btn-lg" href="/arena" style={{ display: 'inline-block' }}>
            {es ? 'Ver la arena en vivo →' : 'Watch the live arena →'}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="miniapp" style={{ minHeight: '100vh' }}>
      <div className="nav" style={{ height: 48 }}>
        <a className="logo" href="/" style={{ fontSize: 15 }}><div className="logo-dot" />kickoff<span>.bot</span></a>
        <div className="nav-right">
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={toggleLang}>
            {es ? 'EN' : 'ES'}
          </button>
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div className="neg-eyebrow" style={{ marginBottom: 12 }}>{es ? 'Vender un producto' : 'Sell a product'}</div>

        {/* photo */}
        <label style={{ display: 'block', marginBottom: 12, cursor: 'pointer' }}>
          <div style={{
            border: '1px dashed var(--border)', borderRadius: 12, height: photo ? 'auto' : 140,
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            background: 'var(--card)',
          }}>
            {photo
              ? <img src={photo} alt="" style={{ width: '100%', display: 'block' }} />
              : <span style={{ color: 'var(--muted)', fontSize: 13 }}>📷 {es ? 'Toca para tomar la foto' : 'Tap to take the photo'}</span>}
          </div>
          <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />
        </label>

        <input
          placeholder={es ? 'Nombre del producto' : 'Product name'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />
        <textarea
          placeholder={es ? 'Descripción — origen, proceso, notas…' : 'Description — origin, process, notes…'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'none' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div className="amt-wrap" style={{ width: 130 }}>
            <input type="number" inputMode="decimal" min="1" placeholder="···" value={price} onChange={(e) => setPrice(e.target.value)} />
            <span>HBAR</span>
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--yellow)' }}>
            🔒 {es ? 'precio secreto' : 'secret price'}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', marginBottom: 14 }}>
          {es
            ? 'Se compromete on-chain. Ni el comprador ni su agente lo ven hasta cerrar.'
            : 'Committed on-chain. Neither the buyer nor their agent sees it until close.'}
        </div>

        {status === 'error' && (
          <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>
            {es ? 'Falta nombre o precio (mín. 1 HBAR)' : 'Missing name or price (min 1 HBAR)'}
          </div>
        )}

        <button
          className="btn-lg"
          style={{ width: '100%', opacity: status === 'sending' ? 0.5 : 1 }}
          disabled={status === 'sending'}
          onClick={submit}
        >
          {status === 'sending'
            ? (es ? '⏳ Comprometiendo on-chain…' : '⏳ Committing on-chain…')
            : (es ? '🔒 Listar con precio secreto' : '🔒 List with secret price')}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '10px 12px', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 13,
  outline: 'none', marginBottom: 10,
};
