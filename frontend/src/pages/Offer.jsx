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
import { toggleLang } from '../i18n';

const BUDGETS = [10, 15, 20, 30, 50];
const STRATEGIES = ['aggressive', 'charming', 'analytical', 'emotional'];

export default function Offer() {
  const { t, i18n } = useTranslation();
  const { negotiations, connected, submitOffer } = useNegotiationFeed();
  const [negotiationId, setNegotiationId] = useState(() => `web-${crypto.randomUUID().slice(0, 8)}`);
  const [mode, setMode] = useState('human');
  const [budgetIdx, setBudgetIdx] = useState(2);
  const [strategy, setStrategy] = useState('charming');
  const [agentStatus, setAgentStatus] = useState(null);
  const [humanVerified, setHumanVerified] = useState(false);
  const [worldEnabled, setWorldEnabled] = useState(false);
  const [activeItem, setActiveItem] = useState(null);

  useEffect(() => {
    fetch('/api/world/config').then((r) => r.json()).then((c) => setWorldEnabled(!!c.enabled)).catch(() => {});
    // Show the actual active listing (name + photo) — not a hardcoded item.
    fetch('/api/listings')
      .then((r) => r.json())
      .then((d) => {
        if (d.active) {
          const full = (d.listings || []).find((l) => l.id === d.active.id);
          setActiveItem({ name: d.active.name, photoUrl: full?.photoUrl });
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

  async function deployAgent() {
    if (agentStatus === 'running') return;
    setAgentStatus('running');
    tg?.HapticFeedback?.impactOccurred?.('medium');
    try {
      const res = await fetch('/api/deploy-buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negotiationId, strategy, maxBudget: BUDGETS[budgetIdx] }),
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
        inputEnabled={mode === 'human' && (!worldEnabled || humanVerified)}
        onSubmitOffer={(price, argument) => submitOffer({ negotiationId, price, argument, buyer })}
      />

      {mode === 'human' && worldEnabled && !humanVerified && !n?.verdict && (
        <WorldGate scope={negotiationId} onVerified={() => setHumanVerified(true)} />
      )}

      {mode === 'agent' && !n?.verdict && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 9 }}>
              {t('deployBuyerAgent')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('maxBudget')}</span>
              <button
                onClick={() => setBudgetIdx((budgetIdx + 1) % BUDGETS.length)}
                style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 10px', color: 'var(--text)', cursor: 'pointer' }}
              >
                {BUDGETS[budgetIdx]} HBAR
              </button>
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
              {agentStatus === 'running' ? `${t('buyerAgent')} · ${t(strategy)} · ${BUDGETS[budgetIdx]} HBAR max` : agentStatus}
            </div>
          )}
          <button
            onClick={deployAgent}
            disabled={agentStatus === 'running'}
            style={{
              width: '100%', padding: 11, background: 'linear-gradient(135deg,#1a1a4e,#2d2b7a)', border: '1px solid rgba(68,136,255,.4)',
              borderRadius: 7, color: 'var(--blue)', fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              opacity: agentStatus === 'running' ? 0.5 : 1, touchAction: 'manipulation',
            }}
          >
            {agentStatus === 'running' ? '⏳ negotiating…' : t('deployBuyerAgent')}
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
