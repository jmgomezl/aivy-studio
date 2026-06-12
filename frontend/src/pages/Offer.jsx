// Telegram Mini App — single-column negotiation view.
// Follows Telegram's color scheme for the chrome; the negotiation itself stays
// dark (on-chain spectacle). Generates one negotiationId per session (lesson D:
// results bind to the exact deal the buyer offered on).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNegotiationFeed } from '../lib/useNegotiation.js';
import NegotiationPanel from '../components/NegotiationPanel.jsx';
import { toggleLang } from '../i18n';

export default function Offer() {
  const { t, i18n } = useTranslation();
  const { negotiations, connected, submitOffer } = useNegotiationFeed();
  const [negotiationId, setNegotiationId] = useState(() => `web-${crypto.randomUUID().slice(0, 8)}`);

  const tg = window.Telegram?.WebApp;
  const buyer = useMemo(() => {
    const u = tg?.initDataUnsafe?.user;
    return u ? `tg:${u.username || u.id}` : 'web-judge';
  }, [tg]);

  useEffect(() => {
    if (!tg) return;
    tg.ready();
    tg.expand();
  }, [tg]);

  const n = negotiations[negotiationId];

  return (
    <div className="miniapp">
      <div className="nav" style={{ height: 48 }}>
        <a className="logo" href="/" style={{ fontSize: 15 }}>
          <div className="logo-dot" />kickoff<span>.bot</span>
        </a>
        <div className="nav-right">
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: connected ? 'var(--accent)' : 'var(--red)' }}>
            {connected ? '● HEDERA LIVE' : '○ OFFLINE'}
          </span>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={toggleLang}>
            {i18n.language === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </div>
      <NegotiationPanel
        negotiation={n}
        compact
        buyerLabel={buyer}
        onSubmitOffer={(price, argument) => submitOffer({ negotiationId, price, argument, buyer })}
      />
      {n?.verdict && (
        <button className="reset-btn" style={{ display: 'block' }} onClick={() => setNegotiationId(`web-${crypto.randomUUID().slice(0, 8)}`)}>
          {t('newNegotiation')}
        </button>
      )}
      <div style={{ padding: '8px 14px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)' }}>
        {t('onChainProof')}
      </div>
    </div>
  );
}
