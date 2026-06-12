// kickoff.bot landing — the marketplace face ("eBay of agents"): LIGHT theme.
// The negotiation surfaces it links to (Offer/Arena) are dark — intentional
// light->dark transition when you go on-chain.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toggleLang } from '../i18n';

export default function Landing() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
    return () => delete document.documentElement.dataset.theme;
  }, []);

  return (
    <div>
      <div className="ticker">
        <div className="ticker-inner">
          {Array.from({ length: 2 }).map((_, k) => (
            <span key={k} style={{ display: 'inline-flex', gap: 48 }}>
              <span className="ticker-item"><span className="ticker-dot" />LIVE ON HEDERA TESTNET · HCS-10 TOPIC 0.0.9217269</span>
              <span className="ticker-item"><span className="ticker-dot" />SELLER AGENT 0.0.9217340 · MIN PRICE COMMITTED ON-CHAIN</span>
              <span className="ticker-item"><span className="ticker-dot" />{t('tagline').toUpperCase()}</span>
              <span className="ticker-item"><span className="ticker-dot" />LEDGER DELEGATION · HTS ESCROW · ELEVENLABS VOICE</span>
            </span>
          ))}
        </div>
      </div>

      <div className="nav">
        <a className="logo" href="/"><div className="logo-dot" />kickoff<span>.bot</span></a>
        <div className="nav-right">
          <Link className="btn-ghost" to="/arena">{t('arena')}</Link>
          <Link className="btn-ghost" to="/studio">{t('studio')}</Link>
          <button className="btn-ghost" onClick={toggleLang}>{i18n.language === 'es' ? 'EN' : 'ES'}</button>
          <Link className="btn-primary" to="/offer">{t('liveDemo')}</Link>
        </div>
      </div>

      <div className="hero">
        <div>
          <div className="hero-eyebrow">Agent-Driven P2P Marketplace · Hedera</div>
          <h1>
            {i18n.language === 'es' ? (
              <>Tu agente<br />negocia.<br /><em>Tú ganas.</em></>
            ) : (
              <>Your agent<br />negotiates.<br /><em>You win.</em></>
            )}
          </h1>
          <p className="hero-sub">{t('heroSub')}</p>
          <div className="hero-actions">
            <Link className="btn-lg" to="/offer">{t('makeOffer')} ⚡</Link>
            <Link className="btn-lg-ghost" to="/arena">{t('arena')} →</Link>
            <a className="btn-lg-ghost" href="https://t.me/cryptokickoffbot" target="_blank" rel="noreferrer">
              {t('openMiniApp')} ✈️
            </a>
          </div>
        </div>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 14 }}>
            ● {t('liveNegotiation')} · HCS-10
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 34 }}>☕</div>
            <div>
              <div style={{ fontWeight: 600 }}>{t('coffeeName')}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                Kickoff Seller Agent · 0.0.9217340
              </div>
            </div>
          </div>
          <ol style={{ paddingLeft: 18, color: 'var(--muted)', fontSize: 13, lineHeight: 2 }}>
            <li>{i18n.language === 'es' ? 'Precio mínimo comprometido on-chain (hash secreto)' : 'Minimum price committed on-chain (secret hash)'}</li>
            <li>{i18n.language === 'es' ? 'Ofreces precio + tu historia' : 'You offer a price + your story'}</li>
            <li>{i18n.language === 'es' ? 'El agente decide y habla su veredicto' : 'The agent decides and speaks its verdict'}</li>
            <li>{i18n.language === 'es' ? 'HBAR se transfiere · el mínimo se revela' : 'HBAR transfers · the minimum is revealed'}</li>
          </ol>
          <div style={{ marginTop: 14, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
            {t('onChainProof')}
          </div>
        </div>
      </div>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '24px', display: 'flex', justifyContent: 'space-between', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
          kickoff<span style={{ color: 'var(--accent)' }}>.bot</span> · by Aivy Labs
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
          <a href="https://github.com/jmgomezl/aivy-studio" target="_blank" rel="noreferrer" style={{ color: 'var(--muted)' }}>GitHub</a>
          <a href="https://aivylabs.xyz" target="_blank" rel="noreferrer" style={{ color: 'var(--muted)' }}>Aivy Labs</a>
          <Link to="/studio" style={{ color: 'var(--muted)' }}>Aivy Studio</Link>
        </div>
      </footer>
    </div>
  );
}
