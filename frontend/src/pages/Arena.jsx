// Arena — projector view. Left: live HCS-10 event feed. Right: the most recent
// negotiation, full drama (meter, reasoning, verdict, reveal). Dark always.
import { useEffect, useMemo, useRef } from 'react';
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
  if (ev.type === 'agent_status') return ['···', 'b-thinking'];
  return ['HCS-10', 'b-thinking'];
}

// The actual content of each event — what makes the feed readable on a projector.
function lineFor(ev) {
  switch (ev.type) {
    case 'offer':
      return `${ev.price} HBAR — ${ev.argument}`;
    case 'agent_reasoning':
      return ev.reasoning || '';
    case 'agent_verdict':
      return ev.spokenVerdict || (ev.decision === 'counter' && ev.counterPrice ? `Counter at ${ev.counterPrice} HBAR` : ev.decision || '');
    case 'agent_status':
      return ev.status || '';
    case 'settlement':
      return ev.txId ? `Settled on-chain · tx ${String(ev.txId).slice(0, 18)}…` : 'Funds released on-chain';
    case 'reveal':
      return `Reserve revealed · min ${ev.minPrice} HBAR · accepted ${ev.acceptedPrice} HBAR`;
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
  return 'r-status';
}

export default function Arena() {
  const { t } = useTranslation();
  const { feed, negotiations, connected } = useNegotiationFeed();
  const feedRef = useRef(null);

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

  return (
    <div className="arena">
      <div className="ticker">
        <div className="ticker-inner">
          {[...closed, ...closed].slice(-24).map((e, i) => (
            <span className="ticker-item" key={i}>
              <span className="ticker-dot" />
              {e.decision === 'accept' ? `DEAL CLOSED · ${e.negotiationId} ✓` : e.decision === 'counter' ? `COUNTER · ${e.negotiationId}` : `REJECTED · ${e.negotiationId}`}
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
              const [label, cls] = badge(ev);
              const isOffer = ev.type === 'offer';
              const isAgentBuyer = isOffer && String(ev.buyer ?? '').startsWith('agent:');
              return (
                <div className={`act-item ${rowTone(ev)}`} key={`${ev.sequence}-${i}`}>
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
          <NegotiationPanel negotiation={current} inputEnabled={false} />
        </div>
      </div>
    </div>
  );
}
