import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:8787/ws');
const events = [];
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.type === 'snapshot') console.log('snapshot: lastSeq', m.state.lastSeq, '— feed', m.state.feed.length, 'events');
  else { events.push(m.event); console.log('ws event:', m.event.type, m.event.negotiationId ?? '', m.event.decision ?? m.event.status ?? m.event.sellProbability ?? ''); }
  if (events.some(e => e.type === 'agent_verdict')) { console.log('FULL CYCLE OVER WEBSOCKET ✓'); process.exit(0); }
});
setTimeout(() => { console.log('timeout — got', events.length, 'events'); process.exit(1); }, 60000);
