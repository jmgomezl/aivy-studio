// Reusable Telegram Login Widget card — used by both /sell (seller identity) and
// /offer (buyer identity). On web it renders Telegram's "Log in" button; on
// success the backend verifies the HMAC, provisions a managed wallet, and returns
// a signed session. Inside the Mini App the identity is already known, so this
// renders nothing. Auth persists in localStorage and is shared across pages.
import { useEffect, useRef, useState } from 'react';
import { tierOf } from '../lib/reputation.js';

const AUTH_KEY = 'kickoff-tg-auth';

export function readTgAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
  } catch {
    return null;
  }
}

export default function TelegramLogin({ onChange, es = false, role = 'seller' }) {
  const tg = window.Telegram?.WebApp;
  const inTelegram = !!tg?.initDataUnsafe?.user;
  const [auth, setAuth] = useState(readTgAuth);
  const [config, setConfig] = useState(null);
  const [copied, setCopied] = useState('');
  const [rep, setRep] = useState(null);
  const [bal, setBal] = useState(null);
  const [subname, setSubname] = useState(null);
  const widgetRef = useRef(null);

  // Pull the signed-in user's reputation (sales / purchases / tier).
  useEffect(() => {
    const id = auth?.profile?.username ? `tg:${auth.profile.username}` : auth?.profile?.telegramId ? `tg:${auth.profile.telegramId}` : null;
    if (!id) return setRep(null);
    fetch(`/api/reputation?id=${encodeURIComponent(id)}`).then((r) => r.json()).then(setRep).catch(() => {});
  }, [auth]);

  // Live KUSD + HBAR balance for the funded managed wallet.
  useEffect(() => {
    const acct = auth?.profile?.hederaAccount;
    if (!acct || !auth?.profile?.funded) return setBal(null);
    let on = true;
    fetch(`/api/wallet/balance?account=${encodeURIComponent(acct)}`)
      .then((r) => r.json())
      .then((b) => { if (on && b.ok) setBal(b); })
      .catch(() => {});
    return () => { on = false; };
  }, [auth]);

  // The agent's ENS fleet subname (<name>.kickoffseller.eth). Minted async on
  // first signup — start from the session, then poll until it lands on-chain.
  useEffect(() => {
    const evm = auth?.profile?.walletEvm;
    setSubname(auth?.profile?.ensSubname || null);
    if (!evm || auth?.profile?.ensSubname) return;
    let on = true, tries = 0;
    const tick = () => {
      if (!on || tries++ > 8) return;
      fetch(`/api/ens/subname?address=${encodeURIComponent(evm)}`)
        .then((r) => r.json())
        .then((d) => { if (on && d.subname) setSubname(d.subname); else if (on) setTimeout(tick, 8000); })
        .catch(() => { if (on) setTimeout(tick, 8000); });
    };
    tick();
    return () => { on = false; };
  }, [auth]);

  function copy(value, key) {
    if (!value || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied(''), 1200);
    }).catch(() => {});
  }

  useEffect(() => {
    fetch('/api/auth/config').then((r) => r.json()).then(setConfig).catch(() => {});
  }, []);

  // Lift the current auth to the parent so it can attach the token to requests.
  useEffect(() => {
    onChange?.(auth);
  }, [auth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (inTelegram || auth || !config?.enabled || !widgetRef.current) return;
    window.onKickoffTelegramAuth = async (user) => {
      try {
        const res = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user),
        });
        const data = await res.json();
        if (data.ok) {
          const next = { token: data.token, profile: data.profile };
          setAuth(next);
          localStorage.setItem(AUTH_KEY, JSON.stringify(next));
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
    s.setAttribute('data-telegram-login', config.botUsername);
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
  }, [inTelegram, auth, config]);

  function signOut() {
    setAuth(null);
    localStorage.removeItem(AUTH_KEY);
  }

  if (inTelegram) return null; // Mini App already knows who you are

  const verb = role === 'buyer'
    ? (es ? 'tus ofertas' : 'your offers')
    : (es ? 'tus listados' : 'your listings');

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
      {auth ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {auth.profile?.photoUrl
            ? <img src={auth.profile.photoUrl} alt="" style={{ width: 30, height: 30, borderRadius: '50%' }} />
            : <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,255,135,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>👤</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
              {role === 'buyer' ? (es ? 'Ofertando como' : 'Offering as') : (es ? 'Listando como' : 'Listing as')} @{auth.profile?.username || auth.profile?.telegramId}
            </div>
            {rep && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '2px 0 1px', flexWrap: 'wrap' }}>
                <span style={{ color: tierOf(rep).color, fontWeight: 700, fontSize: 10 }}>
                  {tierOf(rep).icon} {rep.tier === 'new' ? (es ? 'Nuevo' : 'New') : rep.tier === 'gold' ? (es ? 'Top' : 'Top seller') : tierOf(rep).label}
                </span>
                <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 9 }}>
                  {rep.sales} {es ? 'ventas' : 'sales'} · {rep.buys} {es ? 'compras' : 'buys'}
                  {rep.volumeHbar ? ` · ${rep.volumeHbar} USD` : ''}
                </span>
              </div>
            )}
            {(() => {
              const evm = auth.profile?.walletEvm || '';
              // One key → both chains: EVM address + its Hedera EVM-alias account.
              const hedera = auth.profile?.hederaAccount || (evm ? `0.0.${evm.slice(2).toLowerCase()}` : '');
              const short = (s, head, tail = 0) => (s ? `${s.slice(0, head)}…${tail ? s.slice(-tail) : ''}` : '—');
              const copyBtn = (value, key) => (
                <button
                  onClick={() => copy(value, key)}
                  disabled={!value}
                  title={es ? 'Copiar' : 'Copy'}
                  style={{ background: 'transparent', border: 'none', cursor: value ? 'pointer' : 'default', color: copied === key ? 'var(--accent)' : 'var(--muted)', fontSize: 10, padding: 0, lineHeight: 1 }}
                >
                  {copied === key ? '✓' : '⧉'}
                </button>
              );
              const rowStyle = { display: 'flex', alignItems: 'center', gap: 6 };
              return (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 8.5, color: 'var(--muted)', lineHeight: 1.7 }}>
                  <div style={rowStyle}>EVM <span style={{ color: 'var(--text)' }}>{short(evm, 8, 4)}</span> {copyBtn(evm, 'evm')}</div>
                  <div style={rowStyle}>Hedera <span style={{ color: 'var(--accent)' }}>{short(hedera, 10)}</span> {copyBtn(hedera, 'hedera')}</div>
                  {subname && (
                    <div style={rowStyle}>
                      <a href={`https://sepolia.app.ens.domains/${subname}`} target="_blank" rel="noreferrer" style={{ color: '#6E86FF', fontWeight: 700, textDecoration: 'none' }} title={es ? 'Subnombre ENS de la flota · resuelto en vivo' : 'ENS fleet subname · resolved live'}>
                        🔗 {subname}
                      </a>
                      {copyBtn(subname, 'ens')}
                    </div>
                  )}
                  {(bal || auth.profile?.funded) && (
                    <div style={rowStyle}>
                      <span style={{ color: '#3FE08F', fontWeight: 700 }}>
                        💵 {bal ? bal.usd.toLocaleString() : (auth.profile?.fundedUsd ?? 1000).toLocaleString()} KUSD
                      </span>
                      <span style={{ color: 'var(--muted)' }}>· {bal ? bal.hbar : (auth.profile?.gasHbar ?? 1)} ℏ {es ? 'gas' : 'gas'}</span>
                      {hedera && hedera.startsWith('0.0.') && (
                        <a href={`https://hashscan.io/testnet/account/${hedera}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>↗</a>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <button className="btn-ghost" style={{ padding: '3px 9px', fontSize: 10 }} onClick={signOut}>
            {es ? 'Salir' : 'Sign out'}
          </button>
        </div>
      ) : config?.enabled ? (
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>
            {es ? `Inicia sesión con Telegram para vincular ${verb} a tu identidad (opcional).` : `Sign in with Telegram to tie ${verb} to your identity (optional).`}
          </div>
          <div ref={widgetRef} />
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {role === 'buyer'
            ? (es ? 'Ofertando como invitado anónimo.' : 'Offering as an anonymous guest.')
            : (es ? 'Listando como vendedor anónimo.' : 'Listing as an anonymous seller.')}
        </div>
      )}
    </div>
  );
}
