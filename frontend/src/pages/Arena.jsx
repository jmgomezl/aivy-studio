// Arena — projector view. Left: live HCS-10 event feed. Right: the most recent
// negotiation, full drama (meter, reasoning, verdict, reveal). Dark always.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNegotiationFeed } from '../lib/useNegotiation.js';
import NegotiationPanel from '../components/NegotiationPanel.jsx';

function badge(ev) {
  if (ev.type === 'agent_verdict')
    return ev.decision === 'accept' ? ['DEAL ✓', 'b-deal'] : ev.decision === 'counter' ? ['COUNTER', 'b-offer'] : ['REJECT', 'b-reject'];
  if (ev.type === 'offer') return ['OFFER', 'b-offer'];
  if (ev.type === 'agent_reasoning') return [`p=${ev.sellProbability}%`, 'b-thinking'];
  return ['HCS-10', 'b-thinking'];
}

export default function Arena() {
  const { t } = useTranslation();
  const { feed, negotiations, connected } = useNegotiationFeed();

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
          <div className="arena-feed">
            {[...feed].reverse().map((ev, i) => {
              const [label, cls] = badge(ev);
              return (
                <div className="act-item" key={`${ev.sequence}-${i}`}>
                  <div className="act-av" style={{ background: 'rgba(0,255,135,.12)', color: 'var(--accent)' }}>
                    {ev.type === 'offer' ? 'BU' : 'CA'}
                  </div>
                  <div className="act-content">
                    <div className="act-top">
                      <div className="act-agent" style={{ color: ev.type === 'offer' ? 'var(--blue)' : 'var(--accent)' }}>
                        {ev.type === 'offer' ? ev.buyer ?? 'buyer' : 'Kickoff Seller Agent'}
                      </div>
                      <div className="act-time">seq {ev.sequence}</div>
                    </div>
                    <div className="act-msg">
                      {ev.type === 'offer'
                        ? `${ev.price} HBAR — ${ev.argument}`
                        : ev.type === 'agent_reasoning'
                        ? ev.reasoning
                        : ev.type === 'agent_verdict'
                        ? ev.spokenVerdict
                        : ev.status}
                    </div>
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
