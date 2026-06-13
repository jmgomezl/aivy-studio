// Seller listing flow — the OTHER side of the marketplace.
// A seller (second phone / second Telegram account) snaps a photo, writes a
// description, and sets a SECRET reserve price that gets committed on-chain
// (keccak256(reserve, salt)). The reserve drives the negotiation and the
// dramatic reveal — nobody, not even the buyer's agent, sees it until the deal.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toggleLang } from '../i18n';

function readTgAuth() {
  try {
    return JSON.parse(localStorage.getItem('kickoff-tg-auth') || 'null');
  } catch {
    return null;
  }
}

export default function Sell() {
  const { t, i18n } = useTranslation();
  const [photo, setPhoto] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Other');
  const [status, setStatus] = useState(null); // null | 'sending' | listing | 'error'
  const [errMsg, setErrMsg] = useState(null);
  const [result, setResult] = useState(null);

  const es = i18n.language === 'es';
  const tg = window.Telegram?.WebApp;
  const inTelegram = !!tg?.initDataUnsafe?.user;
  const [tgAuth, setTgAuth] = useState(readTgAuth);
  const [tgConfig, setTgConfig] = useState(null);
  const widgetRef = useRef(null);

  useEffect(() => {
    fetch('/api/auth/config').then((r) => r.json()).then(setTgConfig).catch(() => {});
  }, []);

  // Inject the Telegram Login Widget on web (not inside the Mini App, where the
  // identity is already known). On success the backend verifies the HMAC, mints
  // the seller's managed wallet, and returns a signed session.
  useEffect(() => {
    if (inTelegram || tgAuth || !tgConfig?.enabled || !widgetRef.current) return;
    window.onKickoffTelegramAuth = async (user) => {
      try {
        const res = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user),
        });
        const data = await res.json();
        if (data.ok) {
          const auth = { token: data.token, profile: data.profile };
          setTgAuth(auth);
          localStorage.setItem('kickoff-tg-auth', JSON.stringify(auth));
        }
      } catch {
        /* ignore */
      }
    };
    const container = widgetRef.current;
    container.innerHTML = '';
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.async = true;
    s.setAttribute('data-telegram-login', tgConfig.botUsername);
    s.setAttribute('data-size', 'medium');
    s.setAttribute('data-userpic', 'false');
    s.setAttribute('data-onauth', 'onKickoffTelegramAuth(user)');
    s.setAttribute('data-request-access', 'write');
    container.appendChild(s);
    return () => {
      try {
        delete window.onKickoffTelegramAuth;
      } catch {
        /* ignore */
      }
    };
  }, [inTelegram, tgAuth, tgConfig]);

  function signOut() {
    setTgAuth(null);
    localStorage.removeItem('kickoff-tg-auth');
  }

  // Resize/compress the photo client-side so the upload stays small (phone
  // camera shots are several MB; the body limit and bandwidth don't like that).
  function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        setPhoto(canvas.toDataURL('image/jpeg', 0.7)); // ~200-500KB
      };
      img.onerror = () => setPhoto(reader.result); // fallback to original
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    const p = Number(price);
    if (!name.trim() || !p || p < 1) {
      setErrMsg(es ? 'Falta nombre o precio (mín. 1 HBAR)' : 'Missing name or price (min 1 HBAR)');
      setStatus('error');
      return;
    }
    setErrMsg(null);
    setStatus('sending');
    tg?.HapticFeedback?.impactOccurred?.('medium');
    try {
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          category,
          minPriceHbar: p,
          photoDataUrl: photo,
          seller: inTelegram ? `tg:${tg.initDataUnsafe.user.username || tg.initDataUnsafe.user.id}` : 'web-seller',
          authToken: tgAuth?.token || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrMsg(data.detail || data.error || (es ? `Error al listar (${res.status})` : `Listing failed (${res.status})`));
        setStatus('error');
        return;
      }
      setResult(data.listing);
      setStatus('listing');
    } catch (e) {
      setErrMsg(es ? 'Error de red — reintenta' : 'Network error — try again');
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
          <a className="btn-ghost" href="/offer" style={{ padding: '4px 10px', fontSize: 11 }}>
            🛒 {es ? 'Comprar' : 'Buy'}
          </a>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={toggleLang}>
            {es ? 'EN' : 'ES'}
          </button>
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div className="neg-eyebrow" style={{ marginBottom: 12 }}>{es ? 'Vender un producto' : 'Sell a product'}</div>

        {/* Seller identity (web only — the Mini App already knows who you are) */}
        {!inTelegram && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            {tgAuth ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {tgAuth.profile?.photoUrl
                  ? <img src={tgAuth.profile.photoUrl} alt="" style={{ width: 30, height: 30, borderRadius: '50%' }} />
                  : <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,255,135,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>👤</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                    {es ? 'Listando como' : 'Listing as'} @{tgAuth.profile?.username || tgAuth.profile?.telegramId}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 8.5, color: 'var(--muted)' }}>
                    {es ? 'identidad Telegram · billetera' : 'Telegram identity · wallet'} {(tgAuth.profile?.walletEvm || '').slice(0, 10)}…
                  </div>
                </div>
                <button className="btn-ghost" style={{ padding: '3px 9px', fontSize: 10 }} onClick={signOut}>
                  {es ? 'Salir' : 'Sign out'}
                </button>
              </div>
            ) : tgConfig?.enabled ? (
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>
                  {es
                    ? 'Inicia sesión con Telegram para vincular tus listados a tu identidad (opcional).'
                    : 'Sign in with Telegram to tie your listings to your identity (optional).'}
                </div>
                <div ref={widgetRef} />
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {es ? 'Listando como vendedor anónimo.' : 'Listing as an anonymous seller.'}
              </div>
            )}
          </div>
        )}

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
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, appearance: 'auto' }}>
          {['Electronics', 'Fashion', 'Home', 'Tickets', 'Collectibles', 'Other'].map((c) => (
            <option key={c} value={c}>{es ? `Categoría: ${c}` : `Category: ${c}`}</option>
          ))}
        </select>
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

        {status === 'error' && errMsg && (
          <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{errMsg}</div>
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
