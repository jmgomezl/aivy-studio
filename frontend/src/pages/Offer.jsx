// Telegram Mini App — single-column negotiation view with two modes:
//   Human: judge types price + argument
//   Agent: deploy an autonomous buyer agent (strategy + max budget)
// Follows Telegram's chrome; the negotiation itself stays dark (on-chain
// spectacle). One negotiationId per session (lesson D: results bind to the
// exact deal the buyer offered on).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNegotiationFeed } from '../lib/useNegotiation.js';
import NegotiationPanel from '../components/NegotiationPanel.jsx';
import WorldGate from '../components/WorldGate.jsx';
import TelegramLogin from '../components/TelegramLogin.jsx';
import SellerChat from '../components/SellerChat.jsx';
import VerifyGate from '../components/VerifyGate.jsx';
import { toggleLang } from '../i18n';

const STRATEGIES = ['aggressive', 'charming', 'analytical', 'emotional'];

export default function Offer() {
  const { t, i18n } = useTranslation();
  const { negotiations, connected, submitOffer } = useNegotiationFeed();
  const [negotiationId, setNegotiationId] = useState(() => `web-${crypto.randomUUID().slice(0, 8)}`);
  const [mode, setMode] = useState('human');
  const [maxBudget, setMaxBudget] = useState(20);
  const [strategy, setStrategy] = useState('charming');
  const [agentStatus, setAgentStatus] = useState(null);
  const [humanVerified, setHumanVerified] = useState(false);
  const [worldEnabled, setWorldEnabled] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [tgAuth, setTgAuth] = useState(null);
  const [insured, setInsured] = useState(false);
  const [escrow, setEscrow] = useState(false);

  useEffect(() => {
    fetch('/api/world/config').then((r) => r.json()).then((c) => setWorldEnabled(!!c.enabled)).catch(() => {});
    // Show the actual active listing (name + photo) — not a hardcoded item.
    fetch('/api/listings')
      .then((r) => r.json())
      .then((d) => {
        if (d.active) {
          const full = (d.listings || []).find((l) => l.id === d.active.id);
          setActiveItem({ name: d.active.name, photoUrl: full?.photoUrl, requireHumanVerification: !!d.active.requireHumanVerification });
        }
      })
      .catch(() => {});
  }, []);

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
  // Per-listing human gate, satisfiable by EITHER method (World ID or Telegram).
  const verifyRequired = !!activeItem?.requireHumanVerification;
  const verified = humanVerified || !!tgAuth;

  async function deployAgent() {
    if (agentStatus === 'running') return;
    if (verifyRequired && !verified) return; // owner must be human-verified first
    const budget = Number(maxBudget);
    if (!budget || budget < 1) {
      setAgentStatus('error');
      return;
    }
    setAgentStatus('running');
    tg?.HapticFeedback?.impactOccurred?.('medium');
    try {
      const res = await fetch('/api/deploy-buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negotiationId, strategy, maxBudget: budget }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
    } catch (err) {
      setAgentStatus('error');
    }
  }

  useEffect(() => {
    if (n?.verdict?.decision === 'accept' && agentStatus === 'running') setAgentStatus('closed');
  }, [n?.verdict, agentStatus]);

  function reset() {
    setNegotiationId(`web-${crypto.randomUUID().slice(0, 8)}`);
    setAgentStatus(null);
  }

  return (
    <div className="miniapp">
      <div className="nav" style={{ height: 48 }}>
        <a className="logo" href="/" style={{ fontSize: 15 }}>
          <div className="logo-dot" />kickoff<span>.bot</span>
        </a>
        <div className="nav-right">
          <a className="btn-ghost" href="/sell" style={{ padding: '4px 10px', fontSize: 11 }}>
            🏷️ {i18n.language === 'es' ? 'Vender' : 'Sell'}
          </a>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={toggleLang}>
            {i18n.language === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </div>

      {/* mode tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setMode('human')}
          style={{
            flex: 1, padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 600,
            color: mode === 'human' ? 'var(--text)' : 'var(--muted)',
            borderBottom: `2px solid ${mode === 'human' ? 'var(--accent)' : 'transparent'}`,
          }}
        >
          {t('youNegotiate')}
        </button>
        <button
          onClick={() => setMode('agent')}
          style={{
            flex: 1, padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 600,
            color: mode === 'agent' ? 'var(--blue)' : 'var(--muted)',
            borderBottom: `2px solid ${mode === 'agent' ? 'var(--blue)' : 'transparent'}`,
          }}
        >
          {t('deployAgent')}
        </button>
      </div>

      <NegotiationPanel
        negotiation={n}
        compact
        item={activeItem}
        buyerLabel={buyer}
        inputEnabled={mode === 'human' && (!verifyRequired || verified)}
        onSubmitOffer={(price, argument) => submitOffer({ negotiationId, price, argument, buyer, authToken: tgAuth?.token, insured, escrow })}
      />

      {mode === 'human' && !n?.verdict && (!verifyRequired || verified) && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '10px 14px 0', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)' }}>
          <input type="checkbox" checked={insured} onChange={(e) => setInsured(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
          <span>🛡 {i18n.language === 'es' ? 'Asegurar el paquete (1 HBAR · cubre daño/pérdida)' : 'Insure the package (1 HBAR · covers damage/loss)'}</span>
        </label>
      )}

      {mode === 'human' && !n?.verdict && (!verifyRequired || verified) && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '8px 14px 0', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)' }}>
          <input type="checkbox" checked={escrow} onChange={(e) => setEscrow(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
          <span>🔒 {i18n.language === 'es' ? 'Bloquear fondos en garantía (on-chain · libera al cerrar, reembolsa si rechazan)' : 'Lock funds in escrow (on-chain · released on close, refunded if rejected)'}</span>
        </label>
      )}

      {mode === 'human' && !n?.verdict && (
        <div style={{ padding: '10px 14px 0' }}>
          <SellerChat productName={activeItem?.name} />
        </div>
      )}

      {/* Seller-required human gate (World ID or Telegram). */}
      {mode === 'human' && verifyRequired && !verified && !n?.verdict && (
        <div style={{ padding: '10px 14px 0' }}>
          <VerifyGate
            worldEnabled={worldEnabled}
            scope={negotiationId}
            onWorldVerified={() => setHumanVerified(true)}
            onTgChange={setTgAuth}
          />
        </div>
      )}

      {/* Identity card when no gate is blocking (verified, or not required). */}
      {mode === 'human' && (!verifyRequired || verified) && (
        <div style={{ padding: '10px 14px 0' }}>
          <TelegramLogin role="buyer" es={i18n.language === 'es'} onChange={setTgAuth} />
        </div>
      )}

      {mode === 'agent' && !n?.verdict && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
          {verifyRequired && !verified && (
            <div style={{ marginBottom: 10 }}>
              <VerifyGate
                worldEnabled={worldEnabled}
                scope={negotiationId}
                onWorldVerified={() => setHumanVerified(true)}
                onTgChange={setTgAuth}
              />
            </div>
          )}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 9 }}>
              {t('deployBuyerAgent')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('maxBudget')}</span>
              <div className="amt-wrap" style={{ width: 130 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="1"
                  placeholder="20"
                  value={maxBudget}
                  onChange={(e) => setMaxBudget(e.target.value)}
                />
                <span>HBAR</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('strategy')}</span>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {STRATEGIES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStrategy(s)}
                    style={{
                      padding: '3px 9px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${strategy === s ? 'var(--blue)' : 'var(--border)'}`,
                      background: strategy === s ? 'rgba(68,136,255,.15)' : 'transparent',
                      color: strategy === s ? 'var(--blue)' : 'var(--muted)',
                    }}
                  >
                    {t(s)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {agentStatus && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(68,136,255,.06)', border: '1px solid rgba(68,136,255,.2)', borderRadius: 6, marginBottom: 7, fontFamily: 'var(--mono)', fontSize: 9, color: agentStatus === 'error' ? 'var(--red)' : 'var(--blue)' }}>
              <div className="logo-dot" style={{ background: 'var(--blue)' }} />
              {agentStatus === 'running' ? `${t('buyerAgent')} · ${t(strategy)} · ${maxBudget} HBAR max` : agentStatus}
            </div>
          )}
          <button
            onClick={deployAgent}
            disabled={agentStatus === 'running' || (verifyRequired && !verified)}
            style={{
              width: '100%', padding: 11, background: 'linear-gradient(135deg,#1a1a4e,#2d2b7a)', border: '1px solid rgba(68,136,255,.4)',
              borderRadius: 7, color: 'var(--blue)', fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              opacity: agentStatus === 'running' || (verifyRequired && !verified) ? 0.5 : 1, touchAction: 'manipulation',
            }}
          >
            {verifyRequired && !verified
              ? (i18n.language === 'es' ? '🔒 Verifícate como humano primero' : '🔒 Verify you are human first')
              : agentStatus === 'running' ? '⏳ negotiating…' : t('deployBuyerAgent')}
          </button>
        </div>
      )}

      {n?.verdict && (
        <button className="reset-btn" style={{ display: 'block' }} onClick={reset}>
          {t('newNegotiation')}
        </button>
      )}
      <div style={{ padding: '8px 14px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)' }}>
        {t('onChainProof')}
      </div>
    </div>
  );
}
