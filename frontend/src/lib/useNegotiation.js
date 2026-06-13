// Single WebSocket connection + negotiation state. Reconnects with backoff.
// State derives ONLY from backend events (chain-sourced); no local simulation.
import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL =
  (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

export function useNegotiationFeed() {
  const [feed, setFeed] = useState([]);
  const [negotiations, setNegotiations] = useState({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    let alive = true;
    let retry = 1000;

    function connect() {
      if (!alive) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        retry = 1000;
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'snapshot') {
          setFeed(msg.state.feed);
          setNegotiations(msg.state.negotiations);
        } else if (msg.type === 'event') {
          const ev = msg.event;
          setFeed((f) => [...f.slice(-99), ev]);
          if (ev.negotiationId) {
            setNegotiations((n) => {
              const cur = n[ev.negotiationId] ?? {
                negotiationId: ev.negotiationId,
                offers: [],
                reasoning: [],
                verdict: null,
                status: 'open',
              };
              const next = { ...cur };
              if (ev.type === 'offer') {
                next.offers = [...cur.offers, ev];
                next.status = 'evaluating';
              }
              if (ev.type === 'agent_status') next.status = ev.status;
              if (ev.type === 'agent_reasoning') {
                next.reasoning = [...cur.reasoning, ev];
                next.sellProbability = ev.sellProbability;
              }
              if (ev.type === 'agent_verdict') {
                next.verdict = ev;
                next.status =
                  ev.decision === 'accept' ? 'closed' : ev.decision === 'counter' ? 'countered' : 'rejected';
              }
              if (ev.type === 'settlement') next.settlement = ev;
              if (ev.type === 'reveal') next.reveal = ev;
              return { ...n, [ev.negotiationId]: next };
            });
          }
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (alive) setTimeout(connect, (retry = Math.min(retry * 1.5, 10000)));
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      alive = false;
      wsRef.current?.close();
    };
  }, []);

  const submitOffer = useCallback(async ({ negotiationId, price, argument, buyer, authToken }) => {
    const res = await fetch('/api/offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ negotiationId, price, argument, buyer, authToken }),
    });
    if (!res.ok) throw new Error('offer failed');
    return res.json();
  }, []);

  return { feed, negotiations, connected, submitOffer };
}
