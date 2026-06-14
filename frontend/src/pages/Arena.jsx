// Arena — projector view. Left: live HCS-10 event feed. Right: the most recent
// negotiation, full drama (meter, reasoning, verdict, reveal). Dark always.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNegotiationFeed } from '../lib/useNegotiation.js';
import NegotiationPanel from '../components/NegotiationPanel.jsx';

function badge(ev) {
  if (ev.type === 'agent_verdict')
    return ev.decision === 'accept' ? ['DEAL ✓', 'b-deal'] : ev.decision === 'counter' ? ['COUNTER', 'b-offer'] : ['REJECT', 'b-reject'];
  if (ev.type === 'offer') return ['OFFER', 'b-offer'];
  if (ev.type === 'agent_reasoning') return [`p=${ev.sellProbability}%`, 'b-thinking'];
  if (ev.type === 'settlement') return ['SETTLED', 'b-deal'];
  if (ev.type === 'reveal') return ['REVEAL', 'b-deal'];
  if (ev.type === 'insurance') return ['🛡 INSURED', 'b-deal'];
  if (ev.type === 'payment') return ['💵 PAID', 'b-deal'];
  if (ev.type === 'ledger_approval') return ['🔐 LEDGER', 'b-deal'];
  if (ev.type === 'buyer_done') return ['ENDED ✕', 'b-reject'];
  if (ev.type === 'escrow') return ev.status === 'refunded' ? ['🔒 REFUND', 'b-offer'] : ev.status === 'released' ? ['🔒 RELEASED', 'b-deal'] : ['🔒 ESCROW', 'b-offer'];
  if (ev.type === 'swap') return ev.status === 'failed' ? ['🦄 SWAP ✕', 'b-reject'] : ['🦄 UNISWAP', 'b-deal'];
  if (ev.type === 'swap_status') return ['🦄 …', 'b-thinking'];
  if (ev.type === 'agent_status') return ['···', 'b-thinking'];
  return ['HCS-10', 'b-thinking'];
}

// The actual content of each event — what makes the feed readable on a projector.
function lineFor(ev) {
  switch (ev.type) {
    case 'offer':
      return `${ev.price} USD — ${ev.argument}`;
    case 'agent_reasoning':
      return ev.reasoning || '';
    case 'agent_verdict':
      return ev.spokenVerdict || (ev.decision === 'counter' && ev.counterPrice ? `Counter at ${ev.counterPrice} USD` : ev.decision || '');
    case 'agent_status':
      return ev.status || '';
    case 'settlement':
      return ev.scheduleId
        ? `Scheduled settlement · ${ev.scheduleId}${ev.mode === 'scheduled-pending' ? ' · awaiting Ledger co-sign' : ' · auto-executed'}`
        : ev.txId ? `Settled on-chain · tx ${String(ev.txId).slice(0, 18)}…` : 'Funds released on-chain';
    case 'reveal':
      return `Reserve revealed · min ${ev.minPrice} USD · accepted ${ev.acceptedPrice} USD`;
    case 'insurance':
      return `Package insured on-chain · ${ev.premiumHbar} HBAR premium · covers ${ev.coverageHbar} HBAR${ev.txHash ? ' · ' + String(ev.txHash).slice(0, 12) + '…' : ''}`;
    case 'payment':
      return `Real settlement · ${Number(ev.amountUsd).toLocaleString()} KUSD buyer-funded · ${ev.from} → ${ev.to}${ev.capped ? ' · capped to balance' : ''}`;
    case 'ledger_approval':
      return `Human-in-the-loop · Ledger Clear-Signed${ev.amountUsd ? ' ' + ev.amountUsd + ' USD' : ''} · signer ${String(ev.signer).slice(0, 10)}…${ev.txHash ? ' · ' + String(ev.txHash).slice(0, 12) + '…' : ''}`;
    case 'buyer_done':
      return `Buyer agent ended · no deal (${ev.status})${ev.finalPrice ? ' · last offer ' + ev.finalPrice + ' USD' : ''}`;
    case 'escrow': {
      const verb = ev.status === 'released' ? 'released to seller' : ev.status === 'refunded' ? 'refunded to buyer' : 'locked on-chain';
      const custody = ev.custody === 'operator-funded' ? ' · operator-funded (demo)' : '';
      return `Escrow ${verb} · ${ev.amountHbar} HBAR${custody}${ev.txHash ? ' · ' + String(ev.txHash).slice(0, 12) + '…' : ''}`;
    }
    case 'swap_status':
      return `Converting proceeds → ${ev.tokenOut || 'token'} via Uniswap…`;
    case 'swap':
      if (ev.status === 'failed') return 'Cross-asset swap failed (HBAR settlement stands)';
      return `Cross-asset settle · ${ev.tokenIn || 'ETH'} → ${ev.tokenOut || 'token'} via Uniswap · ${ev.txHash ? String(ev.txHash).slice(0, 14) + '…' : 'executed'}`;
    default:
      return ev.status || '';
  }
}

// Left-border accent per event type — same colour language as the Studio console.
function rowTone(ev) {
  if (ev.type === 'offer') return 'r-offer';
  if (ev.type === 'agent_reasoning') return 'r-reasoning';
  if (ev.type === 'agent_verdict') return ev.decision === 'accept' ? 'r-accept' : ev.decision === 'counter' ? 'r-counter' : 'r-reject';
  if (ev.type === 'settlement') return 'r-accept';
  if (ev.type === 'reveal') return 'r-accept';
  if (ev.type === 'insurance') return 'r-accept';
  if (ev.type === 'payment') return 'r-accept';
  if (ev.type === 'ledger_approval') return 'r-accept';
  if (ev.type === 'buyer_done') return 'r-reject';
  if (ev.type === 'escrow') return ev.status === 'refunded' ? 'r-counter' : 'r-accept';
  if (ev.type === 'swap') return ev.status === 'failed' ? 'r-reject' : 'r-reasoning';
  if (ev.type === 'swap_status') return 'r-reasoning';
  return 'r-status';
}

export default function Arena() {
  const { t } = useTranslation();
  const { feed, negotiations, connected } = useNegotiationFeed();
  const feedRef = useRef(null);
  const [activeItem, setActiveItem] = useState(null);

  // Show the REAL active listing (name + photo) on the projector, not a hardcoded
  // placeholder. Polled so a freshly created listing updates the Arena live.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/listings')
        .then((r) => r.json())
        .then((d) => {
          if (!alive || !d.active) return;
          const full = (d.listings || []).find((l) => l.id === d.active.id);
          setActiveItem({ name: d.active.name, photoUrl: full?.photoUrl });
        })
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // Newest-first: pin the feed to the top whenever a new event lands.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [feed.length]);

  const current = useMemo(() => {
    const ids = Object.keys(negotiations);
    if (!ids.length) return null;
    return ids
      .map((id) => negotiations[id])
      .sort((a, b) => (b.offers[b.offers.length - 1]?.sequence ?? 0) - (a.offers[a.offers.length - 1]?.sequence ?? 0))[0];
  }, [negotiations]);

  const closed = feed.filter((e) => e.type === 'agent_verdict');

  // A verdict is "interim" (the negotiation kept going) when a later offer exists
  // for that negotiation — so a below-reserve reject is a live round, not a final no.
  const lastOfferSeq = useMemo(() => {
    const m = {};
    for (const e of feed) if (e.type === 'offer' && e.negotiationId) m[e.negotiationId] = Math.max(m[e.negotiationId] || 0, e.sequence || 0);
    return m;
  }, [feed]);
  const isInterim = (e) => (lastOfferSeq[e.negotiationId] || 0) > (e.sequence || 0);

  // Negotiations driven by an autonomous buyer agent — their below-reserve rejects
  // are hold-outs in an ongoing barter, not a final no.
  const agentNegs = useMemo(() => {
    const s = new Set();
    for (const e of feed) if (e.type === 'offer' && String(e.buyer ?? '').startsWith('agent:') && e.negotiationId) s.add(e.negotiationId);
    return s;
  }, [feed]);
  const stillNegotiating = (e) => isInterim(e) || agentNegs.has(e.negotiationId);

  return (
    <div className="arena">
      <div className="ticker">
        <div className="ticker-inner">
          {[...closed, ...closed].slice(-24).map((e, i) => (
            <span className="ticker-item" key={i}>
              <span className="ticker-dot" />
              {e.decision === 'accept'
                ? `DEAL CLOSED · ${e.negotiationId} ✓`
                : stillNegotiating(e)
                ? `NEGOTIATING · ${e.negotiationId}`
                : e.decision === 'counter'
                ? `COUNTER · ${e.negotiationId}`
                : `PASSED · ${e.negotiationId}`}
            </span>
          ))}
          {!closed.length && (
            <span className="ticker-item"><span className="ticker-dot" />KICKOFF.BOT · AGENT MARKETPLACE ON HEDERA · HCS-10 · {t('tagline').toUpperCase()}</span>
          )}
        </div>
      </div>
      <div className="arena-body">
        <div className="arena-left">
          <div className="arena-left-header">
            <span>{t('liveActivity')}</span>
            <span style={{ color: connected ? 'var(--accent)' : 'var(--red)' }}>
              {connected ? '● HEDERA LIVE · topic 0.0.9217269' : '○ RECONNECTING'}
            </span>
          </div>
          <div className="arena-feed" ref={feedRef}>
            {[...feed].reverse().map((ev, i) => {
              const line = lineFor(ev);
              if (!line) return null; // skip empty/noise rows
              let [label, cls] = badge(ev);
              let tone = rowTone(ev);
              // Soften below-reserve rejects that were just a live round, not a final no.
              if (ev.type === 'agent_verdict' && ev.decision !== 'accept' && stillNegotiating(ev)) {
                label = ev.decision === 'counter' ? 'COUNTER' : 'HOLDING';
                cls = 'b-offer';
                tone = 'r-counter';
              }
              const isOffer = ev.type === 'offer';
              const isAgentBuyer = isOffer && String(ev.buyer ?? '').startsWith('agent:');
              return (
                <div className={`act-item ${tone}`} key={`${ev.sequence}-${i}`}>
                  <div className="act-av" style={{ background: 'rgba(0,255,135,.12)', color: 'var(--accent)' }}>
                    {isOffer ? (isAgentBuyer ? 'BA' : 'BU') : 'CA'}
                  </div>
                  <div className="act-content">
                    <div className="act-top">
                      <div className="act-agent" style={{ color: isOffer ? 'var(--blue)' : 'var(--accent)' }}>
                        {isOffer ? ev.buyer ?? 'buyer' : 'Kickoff Seller Agent'}
                      </div>
                      <div className="act-time">seq {ev.sequence}</div>
                    </div>
                    <div className="act-msg">{line}</div>
                  </div>
                  <div className={`act-badge ${cls}`}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="arena-right">
          <NegotiationPanel negotiation={current} inputEnabled={false} item={activeItem} />
        </div>
      </div>
    </div>
  );
}
