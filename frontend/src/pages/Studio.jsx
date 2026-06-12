// Aivy Studio — visual canvas for multi-agent workflows on Hedera.
// n8n-style: template library on the left, draggable node graph on the right.
// "Activate" connects to the live backend: node status dots light up as real
// HCS-10 events flow (the Kickoff flow running for real, not a simulation).
import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from 'react-i18next';
import { useNegotiationFeed } from '../lib/useNegotiation.js';
import KickoffNode from '../components/nodes/KickoffNode.jsx';
import template from '../../../templates/kickoff.json';
import { toggleLang } from '../i18n';

const nodeTypes = { kickoffNode: KickoffNode };

const edgeStyle = { stroke: '#1C1C2E', strokeWidth: 1.5 };
const edgeLabelStyle = { fill: '#55556A', fontFamily: 'Space Mono', fontSize: 9 };

export default function Studio() {
  const { t, i18n } = useTranslation();
  const { feed, connected } = useNegotiationFeed();
  const [active, setActive] = useState(false);

  const initialNodes = useMemo(() => template.nodes, []);
  const initialEdges = useMemo(
    () =>
      template.edges.map((e) => ({
        ...e,
        animated: false,
        style: edgeStyle,
        labelStyle: edgeLabelStyle,
        labelBgStyle: { fill: '#0F0F18' },
      })),
    []
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect = useCallback((c) => setEdges((eds) => addEdge({ ...c, style: edgeStyle }, eds)), [setEdges]);

  // When the flow is active, light nodes up from real events.
  const lastEvent = feed[feed.length - 1];
  const liveNodes = useMemo(() => {
    if (!active) return nodes;
    const hot = new Set(['hcs10']);
    if (lastEvent?.type === 'offer') hot.add('buyer');
    if (lastEvent?.type === 'agent_reasoning' || lastEvent?.type === 'agent_status') hot.add('seller-agent');
    if (lastEvent?.type === 'agent_verdict') {
      hot.add('seller-agent');
      hot.add('voice');
      if (lastEvent.decision === 'accept') hot.add('escrow');
    }
    return nodes.map((n) => ({ ...n, data: { ...n.data, live: hot.has(n.id) } }));
  }, [nodes, active, lastEvent]);

  function activate() {
    setActive((a) => !a);
    setEdges((eds) => eds.map((e) => ({ ...e, animated: !active })));
  }

  return (
    <div className="studio">
      <div className="nav" style={{ height: 50 }}>
        <a className="logo" href="/" style={{ fontSize: 15 }}>
          <div className="logo-dot" style={{ background: 'var(--purple-light)' }} />aivy<span style={{ color: 'var(--purple-light)' }}> studio</span>
        </a>
        <div className="nav-right">
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: connected ? 'var(--accent)' : 'var(--muted)' }}>
            {connected ? '● HEDERA TESTNET' : '○ OFFLINE'}
          </span>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={toggleLang}>
            {i18n.language === 'es' ? 'EN' : 'ES'}
          </button>
          <button className="btn-primary" onClick={activate}>
            {active ? '■ Stop' : `▶ ${t('activate')}`}
          </button>
        </div>
      </div>
      <div className="studio-body">
        <div className="studio-sidebar">
          <div className="sidebar-title">{t('templateLibrary')}</div>
          <div className="template-card active">
            <div className="template-name">☕ {t('kickoffTemplate')}</div>
            <div className="template-desc">{template.description}</div>
            <div className="template-meta">8 nodes · 9 edges · hedera-testnet</div>
          </div>
          <div className="template-card ghost">
            <div className="template-name">🏷️ Auction House</div>
            <div className="template-desc">{t('comingSoon')}</div>
          </div>
          <div className="template-card ghost">
            <div className="template-name">🛒 Supply Negotiator</div>
            <div className="template-desc">{t('comingSoon')}</div>
          </div>
          {active && (
            <div className="studio-status">
              <div className="logo-dot" /> {t('activeFlow')}
            </div>
          )}
        </div>
        <div style={{ minHeight: 0 }}>
          <ReactFlow
            nodes={liveNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1C1C2E" gap={22} />
            <Controls />
            <MiniMap pannable zoomable style={{ background: '#0F0F18' }} />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
