// Reusable Telegram Login Widget card — used by both /sell (seller identity) and
// /offer (buyer identity). On web it renders Telegram's "Log in" button; on
// success the backend verifies the HMAC, provisions a managed wallet, and returns
// a signed session. Inside the Mini App the identity is already known, so this
// renders nothing. Auth persists in localStorage and is shared across pages.
import { useEffect, useRef, useState } from 'react';

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
  const widgetRef = useRef(null);

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
            {(() => {
              const evm = auth.profile?.walletEvm || '';
              // One key → both chains: EVM address + its Hedera EVM-alias account.
              const hedera = auth.profile?.hederaAccount || (evm ? `0.0.${evm.slice(2).toLowerCase()}` : '');
              const short = (s, head, tail = 0) => (s ? `${s.slice(0, head)}…${tail ? s.slice(-tail) : ''}` : '—');
              return (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 8.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                  <div>EVM <span style={{ color: 'var(--text)' }}>{short(evm, 8, 4)}</span></div>
                  <div>Hedera <span style={{ color: 'var(--accent)' }}>{short(hedera, 10)}</span></div>
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
