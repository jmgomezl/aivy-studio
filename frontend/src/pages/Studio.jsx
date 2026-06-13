// Aivy Studio — visual canvas for multi-agent workflows on Hedera.
// n8n-style: template library on the left, draggable node graph on the right.
// "Activate" connects to the live backend: node status dots light up as real
// HCS-10 events flow (the Kickoff flow running for real, not a simulation).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from 'react-i18next';
import { useNegotiationFeed } from '../lib/useNegotiation.js';
import KickoffNode from '../components/nodes/KickoffNode.jsx';
import template from '../../../templates/kickoff.json';
import { toggleLang } from '../i18n';
import {
  clearDraft,
  deleteWorkflow,
  readDraft,
  readLastOpenedWorkflowId,
  readWorkflows,
  saveDraft,
  saveWorkflow,
  writeLastOpenedWorkflowId,
} from '../lib/workflowStore.js';

const nodeTypes = { kickoffNode: KickoffNode };

const edgeStyle = { stroke: '#4B4B68', strokeWidth: 1.7 };
const selectedEdgeStyle = { stroke: '#00FF87', strokeWidth: 2.6 };
const activeEdgeStyle = { stroke: '#00FF87', strokeWidth: 2.2 };
const edgeLabelStyle = { fill: '#D6D6E7', fontFamily: 'Space Mono', fontSize: 9, fontWeight: 700 };
const edgeLabelBgStyle = { fill: '#0F0F18' };
const edgeMarker = { type: MarkerType.ArrowClosed, width: 14, height: 14, color: edgeStyle.stroke };
const selectedEdgeMarker = { ...edgeMarker, color: selectedEdgeStyle.stroke };

function styleEdges(edges, animated = false) {
  return edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    animated,
    style: edgeStyle,
    markerEnd: edgeMarker,
    labelStyle: edgeLabelStyle,
    labelBgStyle: edgeLabelBgStyle,
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
  }));
}

function cloneNodes(nodes) {
  return nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    data: { ...node.data, config: { ...(node.data?.config || {}) }, live: false },
  }));
}

function cleanNodes(nodes) {
  return nodes.map(({ id, type, position, data }) => ({
    id,
    type,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
    data: {
      icon: data.icon,
      color: data.color,
      title: data.title,
      sub: data.sub,
      detail: data.detail,
      kind: data.kind,
      config: Object.fromEntries(Object.entries(data.config || {}).filter(([, value]) => String(value || '').trim())),
    },
  }));
}

function cleanEdges(edges) {
  return edges.map(({ id, source, target, sourceHandle, targetHandle, label }) => ({
    id,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(targetHandle ? { targetHandle } : {}),
    ...(label ? { label } : {}),
  }));
}

function workflowSnapshot(name, nodes, edges) {
  return JSON.stringify({
    name,
    nodes: cleanNodes(nodes),
    edges: cleanEdges(edges),
  });
}

function defaultEdgeLabel(sourceNode, targetNode) {
  const sourceKind = sourceNode?.data?.kind;
  const targetKind = targetNode?.data?.kind;

  if (sourceKind === 'agent' && targetKind === 'hcs10') return 'message';
  if (sourceKind === 'hcs10' && targetKind === 'agent') return 'event';
  if (sourceKind === 'agent' && targetKind === 'escrow') return 'settle';
  if (sourceKind === 'approval' && targetKind === 'scheduled') return 'approve';
  if (sourceKind === 'human' && targetKind === 'agent') return 'prompt';
  if (sourceKind === 'scheduled' && targetKind === 'contract') return 'execute';
  if (sourceKind === 'contract' && targetKind === 'escrow') return 'release';
  if (targetKind === 'voice') return 'notify';

  return 'handoff';
}

const nodeConfigFields = {
  agent: [
    { key: 'model', type: 'select', options: ['gpt-4o', 'claude-4.5', 'local-llm'] },
    { key: 'personality', type: 'select', options: ['analytical', 'charming', 'aggressive', 'neutral'] },
    { key: 'tools', placeholder: 'hcs10, escrow, voice' },
    { key: 'systemPrompt', type: 'textarea' },
  ],
  hcs10: [
    { key: 'network', type: 'select', options: ['hedera-testnet', 'hedera-mainnet'] },
    { key: 'topicId', placeholder: '0.0.xxxxxxx' },
    { key: 'memo', placeholder: 'workflow-audit-channel' },
    { key: 'retention', placeholder: '90 days' },
  ],
  escrow: [
    { key: 'token', placeholder: 'HBAR / HTS token id' },
    { key: 'amount', placeholder: '50' },
    { key: 'releaseRule', type: 'select', options: ['on-accept', 'manual-approval', 'scheduled-release'] },
    { key: 'refundWindow', placeholder: '24h' },
  ],
  contract: [
    { key: 'chain', type: 'select', options: ['hedera-evm', 'ethereum', 'base'] },
    { key: 'address', placeholder: '0x...' },
    { key: 'functionName', placeholder: 'settleDeal' },
    { key: 'gasLimit', placeholder: '250000' },
  ],
  approval: [
    { key: 'wallet', placeholder: 'Ledger / Safe / account id' },
    { key: 'threshold', placeholder: '<= 50 HBAR' },
    { key: 'approvers', placeholder: 'ops, finance' },
    { key: 'timeout', placeholder: '2h' },
  ],
  voice: [
    { key: 'voiceId', placeholder: 'elevenlabs voice id' },
    { key: 'model', placeholder: 'eleven_multilingual_v2' },
    { key: 'language', type: 'select', options: ['en', 'es', 'pt'] },
    { key: 'delivery', type: 'select', options: ['browser', 'telegram', 'webhook'] },
  ],
  human: [
    { key: 'channel', type: 'select', options: ['telegram', 'web', 'email'] },
    { key: 'requiredInput', placeholder: 'price + argument' },
    { key: 'timeout', placeholder: '15m' },
    { key: 'fallback', placeholder: 'route to agent' },
  ],
  scheduled: [
    { key: 'schedule', placeholder: 'after approval' },
    { key: 'executionWindow', placeholder: '30m' },
    { key: 'payer', placeholder: '0.0.xxxxxxx' },
    { key: 'memo', placeholder: 'scheduled settlement' },
  ],
  uniswap: [
    { key: 'tokenIn', placeholder: 'USDC' },
    { key: 'tokenOut', placeholder: 'HBAR' },
    { key: 'slippage', placeholder: '0.5%' },
    { key: 'router', placeholder: '0x...' },
  ],
  custom: [
    { key: 'apiName', placeholder: 'external service' },
    { key: 'endpoint', placeholder: 'https://...' },
    { key: 'auth', type: 'select', options: ['none', 'api-key', 'oauth'] },
  ],
};

function studioNode(id, kind, icon, color, title, sub, detail, x, y, config = {}) {
  return {
    id,
    type: 'kickoffNode',
    position: { x, y },
    data: { kind, icon, color, title, sub, detail, config },
  };
}

const studioTemplateDefinitions = [
  {
    id: 'auction-house',
    emoji: '🏷️',
    titleKey: 'studioTemplates.auction.title',
    descKey: 'studioTemplates.auction.desc',
    nodes: [
      studioNode('auction-bidder', 'agent', '🤖', '#A78BFA', 'Bidder Agent', 'strategy + max bid', 'evaluates lots and submits bids', 80, 120, {
        model: 'gpt-4o',
        personality: 'analytical',
        tools: 'hcs10, escrow',
      }),
      studioNode('auction-channel', 'hcs10', '⬡', '#00FF87', 'Auction Channel', 'HCS-10 topic', 'bid events and winner audit trail', 340, 120, {
        network: 'hedera-testnet',
        memo: 'auction-house-bids',
      }),
      studioNode('auction-seller', 'agent', '🤖', '#A78BFA', 'Seller Agent', 'reserve logic', 'accepts winner above reserve', 600, 120, {
        model: 'gpt-4o',
        personality: 'neutral',
      }),
      studioNode('auction-approval', 'approval', '🔐', '#FF4444', 'Reserve Gate', 'human override', 'asks approval when below reserve', 600, 300, {
        threshold: 'below reserve',
        timeout: '15m',
      }),
      studioNode('auction-escrow', 'escrow', '💰', '#FFB800', 'Bid Escrow', 'HBAR lock', 'locks winning bid and releases settlement', 860, 120, {
        token: 'HBAR',
        releaseRule: 'on-accept',
      }),
    ],
    edges: [
      { id: 'auction-edge-bidder-channel', source: 'auction-bidder', target: 'auction-channel', label: 'bid' },
      { id: 'auction-edge-channel-seller', source: 'auction-channel', target: 'auction-seller', label: 'event' },
      { id: 'auction-edge-seller-approval', source: 'auction-seller', target: 'auction-approval', label: 'reserve check' },
      { id: 'auction-edge-seller-escrow', source: 'auction-seller', target: 'auction-escrow', label: 'settle' },
    ],
  },
  {
    id: 'supply-negotiator',
    emoji: '🛒',
    titleKey: 'studioTemplates.supply.title',
    descKey: 'studioTemplates.supply.desc',
    nodes: [
      studioNode('supply-buyer', 'agent', '🤖', '#A78BFA', 'Buyer Agent', 'procurement policy', 'requests quote and checks budget', 80, 130, {
        model: 'gpt-4o',
        tools: 'hcs10, contract',
      }),
      studioNode('supply-channel', 'hcs10', '⬡', '#00FF87', 'Quote Channel', 'supplier topic', 'quote and counter-offer audit trail', 330, 130, {
        network: 'hedera-testnet',
        memo: 'supplier-quotes',
      }),
      studioNode('supply-vendor', 'agent', '🤖', '#A78BFA', 'Vendor Agent', 'margin guardrail', 'responds with price and delivery terms', 580, 130, {
        personality: 'charming',
      }),
      studioNode('supply-contract', 'contract', '🔒', '#FFB800', 'Purchase Contract', 'terms hash', 'commits accepted quantity and delivery SLA', 830, 130, {
        chain: 'hedera-evm',
        functionName: 'commitPurchaseOrder',
      }),
      studioNode('supply-payment', 'scheduled', '⏱', '#7C3AED', 'Scheduled Payment', 'net terms', 'queues payment after delivery approval', 830, 310, {
        schedule: 'net-30',
        executionWindow: '24h',
      }),
    ],
    edges: [
      { id: 'supply-edge-buyer-channel', source: 'supply-buyer', target: 'supply-channel', label: 'rfq' },
      { id: 'supply-edge-channel-vendor', source: 'supply-channel', target: 'supply-vendor', label: 'quote' },
      { id: 'supply-edge-vendor-contract', source: 'supply-vendor', target: 'supply-contract', label: 'terms' },
      { id: 'supply-edge-contract-payment', source: 'supply-contract', target: 'supply-payment', label: 'schedule' },
    ],
  },
  {
    id: 'dao-approval',
    emoji: '🗳️',
    titleKey: 'studioTemplates.dao.title',
    descKey: 'studioTemplates.dao.desc',
    nodes: [
      studioNode('dao-human', 'human', '👤', '#4488FF', 'Proposal Intake', 'member request', 'captures proposal and requested spend', 80, 120, {
        channel: 'web',
        requiredInput: 'proposal + budget',
      }),
      studioNode('dao-agent', 'agent', '🤖', '#A78BFA', 'Summary Agent', 'risk brief', 'summarizes proposal and flags risk', 330, 120, {
        model: 'gpt-4o',
        personality: 'analytical',
      }),
      studioNode('dao-audit', 'hcs10', '⬡', '#00FF87', 'DAO Audit Topic', 'public trail', 'records summary and decision events', 580, 120, {
        network: 'hedera-testnet',
        memo: 'dao-approvals',
      }),
      studioNode('dao-gate', 'approval', '🔐', '#FF4444', 'Multisig Gate', 'member approval', 'waits for threshold signature', 830, 120, {
        wallet: 'Safe',
        threshold: '3 of 5',
      }),
      studioNode('dao-tx', 'scheduled', '⏱', '#7C3AED', 'Treasury Tx', 'queued transfer', 'executes approved spend', 830, 300, {
        schedule: 'after quorum',
        memo: 'dao treasury release',
      }),
    ],
    edges: [
      { id: 'dao-edge-human-agent', source: 'dao-human', target: 'dao-agent', label: 'proposal' },
      { id: 'dao-edge-agent-audit', source: 'dao-agent', target: 'dao-audit', label: 'summary' },
      { id: 'dao-edge-audit-gate', source: 'dao-audit', target: 'dao-gate', label: 'vote event' },
      { id: 'dao-edge-gate-tx', source: 'dao-gate', target: 'dao-tx', label: 'approve' },
    ],
  },
  {
    id: 'escrow-release',
    emoji: '🔓',
    titleKey: 'studioTemplates.escrowRelease.title',
    descKey: 'studioTemplates.escrowRelease.desc',
    nodes: [
      studioNode('release-human', 'human', '👤', '#4488FF', 'Release Trigger', 'buyer confirmation', 'captures delivery confirmation', 80, 120, {
        channel: 'telegram',
        requiredInput: 'delivery accepted',
      }),
      studioNode('release-contract', 'contract', '🔒', '#FFB800', 'Condition Check', 'settlement rule', 'verifies delivery, deadline, and dispute flags', 330, 120, {
        chain: 'hedera-evm',
        functionName: 'canRelease',
      }),
      studioNode('release-escrow', 'escrow', '💰', '#FFB800', 'Escrow Release', 'fund movement', 'releases funds or routes refund', 580, 120, {
        token: 'HBAR',
        releaseRule: 'manual-approval',
      }),
      studioNode('release-voice', 'voice', '🗣️', '#00C8FF', 'Release Notice', 'voice/webhook', 'notifies both parties after settlement', 830, 120, {
        delivery: 'webhook',
        language: 'en',
      }),
    ],
    edges: [
      { id: 'release-edge-human-contract', source: 'release-human', target: 'release-contract', label: 'confirm' },
      { id: 'release-edge-contract-escrow', source: 'release-contract', target: 'release-escrow', label: 'release' },
      { id: 'release-edge-escrow-voice', source: 'release-escrow', target: 'release-voice', label: 'notify' },
    ],
  },
];

function normalizeImportedWorkflow(value, fallbackName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid');
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('invalid');
  }

  const nodeIds = new Set();
  const nodes = value.nodes.map((node, index) => {
    const id = typeof node?.id === 'string' && node.id.trim() ? node.id.trim() : `node-${index + 1}`;
    if (nodeIds.has(id)) throw new Error('duplicate-node');
    nodeIds.add(id);

    const position = node?.position || {};
    const data = node?.data || {};
    return {
      id,
      type: 'kickoffNode',
      position: {
        x: Number.isFinite(Number(position.x)) ? Number(position.x) : index * 220,
        y: Number.isFinite(Number(position.y)) ? Number(position.y) : 120,
      },
      data: {
        icon: typeof data.icon === 'string' && data.icon ? data.icon : '🤖',
        color: typeof data.color === 'string' && data.color ? data.color : '#A78BFA',
        title: typeof data.title === 'string' && data.title ? data.title : `Node ${index + 1}`,
        sub: typeof data.sub === 'string' ? data.sub : '',
        detail: typeof data.detail === 'string' ? data.detail : '',
        kind: typeof data.kind === 'string' && data.kind ? data.kind : 'custom',
        config:
          data.config && typeof data.config === 'object' && !Array.isArray(data.config)
            ? Object.fromEntries(Object.entries(data.config).map(([key, value]) => [key, String(value ?? '')]))
            : {},
      },
    };
  });

  const edges = value.edges.map((edge, index) => {
    if (!nodeIds.has(edge?.source) || !nodeIds.has(edge?.target)) {
      throw new Error('invalid-edge');
    }

    return {
      id: typeof edge.id === 'string' && edge.id.trim() ? edge.id.trim() : `edge-${edge.source}-${edge.target}-${index + 1}`,
      source: edge.source,
      target: edge.target,
      ...(typeof edge.sourceHandle === 'string' && edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(typeof edge.targetHandle === 'string' && edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      ...(typeof edge.label === 'string' && edge.label ? { label: edge.label } : {}),
    };
  });

  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : fallbackName,
    nodes,
    edges,
  };
}

function buildSimulationSteps(nodes, edges) {
  if (!nodes.length) return [];

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));

  edges.forEach((edge) => {
    if (!byId.has(edge.source) || !byId.has(edge.target)) return;
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)?.push(edge);
  });

  const sortByPosition = (a, b) => {
    const aNode = byId.get(a.target || a.id);
    const bNode = byId.get(b.target || b.id);
    return (aNode?.position.x || 0) - (bNode?.position.x || 0) || (aNode?.position.y || 0) - (bNode?.position.y || 0);
  };

  outgoing.forEach((nodeEdges) => nodeEdges.sort(sortByPosition));

  const roots = nodes
    .filter((node) => !incoming.get(node.id))
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const queue = roots.length ? roots : [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const seen = new Set();
  const steps = [];

  while (queue.length) {
    const node = queue.shift();
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    steps.push({ nodeId: node.id });

    for (const edge of outgoing.get(node.id) || []) {
      steps.push({ nodeId: edge.target, edgeId: edge.id });
      queue.push(byId.get(edge.target));
    }
  }

  for (const node of nodes) {
    if (!seen.has(node.id)) steps.push({ nodeId: node.id });
  }

  return steps;
}

export default function Studio() {
  const { t, i18n } = useTranslation();
  const { feed, connected } = useNegotiationFeed();
  const importInputRef = useRef(null);
  const restoreAttemptedRef = useRef(false);
  const [active, setActive] = useState(false);
  const [simulationStep, setSimulationStep] = useState(0);
  const [simulationAuto, setSimulationAuto] = useState(true);
  const [simulationDelay, setSimulationDelay] = useState(850);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [savedWorkflows, setSavedWorkflows] = useState(() => readWorkflows());
  const [currentWorkflowId, setCurrentWorkflowId] = useState('kickoff');
  const [workflowName, setWorkflowName] = useState(template.name);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [nodeClipboard, setNodeClipboard] = useState(null);
  const [connectionNotice, setConnectionNotice] = useState('');
  const paletteNodes = useMemo(
    () => [
      { kind: 'agent', icon: '🤖', color: '#A78BFA', title: t('palette.agent.title'), sub: t('palette.agent.sub'), detail: t('palette.agent.detail') },
      { kind: 'hcs10', icon: '⬡', color: '#00FF87', title: t('palette.hcs10.title'), sub: t('palette.hcs10.sub'), detail: t('palette.hcs10.detail') },
      { kind: 'escrow', icon: '💰', color: '#FFB800', title: t('palette.escrow.title'), sub: t('palette.escrow.sub'), detail: t('palette.escrow.detail') },
      { kind: 'contract', icon: '🔒', color: '#FFB800', title: t('palette.contract.title'), sub: t('palette.contract.sub'), detail: t('palette.contract.detail') },
      { kind: 'approval', icon: '🔐', color: '#FF4444', title: t('palette.approval.title'), sub: t('palette.approval.sub'), detail: t('palette.approval.detail') },
      { kind: 'voice', icon: '🗣️', color: '#00C8FF', title: t('palette.voice.title'), sub: t('palette.voice.sub'), detail: t('palette.voice.detail') },
      { kind: 'human', icon: '👤', color: '#4488FF', title: t('palette.human.title'), sub: t('palette.human.sub'), detail: t('palette.human.detail') },
      { kind: 'scheduled', icon: '⏱', color: '#7C3AED', title: t('palette.scheduled.title'), sub: t('palette.scheduled.sub'), detail: t('palette.scheduled.detail') },
      { kind: 'uniswap', icon: '🦄', color: '#FF007A', title: t('palette.uniswap.title'), sub: t('palette.uniswap.sub'), detail: t('palette.uniswap.detail') },
    ],
    [t]
  );
  const studioTemplates = useMemo(
    () =>
      studioTemplateDefinitions.map((starter) => ({
        ...starter,
        title: t(starter.titleKey),
        description: t(starter.descKey),
      })),
    [t]
  );

  const initialNodes = useMemo(() => cloneNodes(template.nodes), []);
  const initialEdges = useMemo(() => styleEdges(template.edges), []);
  const initialSnapshot = useMemo(() => workflowSnapshot(template.name, initialNodes, initialEdges), [initialEdges, initialNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [lastCleanSnapshot, setLastCleanSnapshot] = useState(initialSnapshot);
  const [saveNotice, setSaveNotice] = useState(false);
  const [draftNotice, setDraftNotice] = useState(false);
  const [importError, setImportError] = useState('');
  const [publishState, setPublishState] = useState('idle'); // idle | publishing | done | error
  const onConnect = useCallback(
    (connection) => {
      if (connection.source === connection.target) {
        setConnectionNotice(t('selfConnectionBlocked'));
        return;
      }

      const existingEdge = edges.find(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          (edge.sourceHandle || null) === (connection.sourceHandle || null) &&
          (edge.targetHandle || null) === (connection.targetHandle || null)
      );

      if (existingEdge) {
        setSelectedNodeId(null);
        setSelectedEdgeId(existingEdge.id);
        setConnectionNotice(t('duplicateConnectionBlocked'));
        return;
      }

      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = nodes.find((node) => node.id === connection.target);
      const edgeId = `edge-${connection.source}-${connection.target}-${Date.now().toString(36)}`;
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: edgeId,
            type: 'smoothstep',
            label: defaultEdgeLabel(sourceNode, targetNode),
            animated: active,
            style: edgeStyle,
            markerEnd: edgeMarker,
            labelStyle: edgeLabelStyle,
            labelBgStyle: edgeLabelBgStyle,
            labelBgPadding: [6, 3],
            labelBgBorderRadius: 4,
          },
          eds
        )
      );
      setSelectedNodeId(null);
      setSelectedEdgeId(edgeId);
      markWorkflowEditable();
    },
    [active, edges, nodes, setEdges, t]
  );

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId), [edges, selectedEdgeId]);
  const selectedNodeConfigFields = nodeConfigFields[selectedNode?.data?.kind] || nodeConfigFields.custom;
  const isKickoffWorkflow = currentWorkflowId === 'kickoff';
  const currentSnapshot = useMemo(() => workflowSnapshot(workflowName, nodes, edges), [edges, nodes, workflowName]);
  const hasUnsavedChanges = currentSnapshot !== lastCleanSnapshot;
  const simulationSteps = useMemo(() => buildSimulationSteps(nodes, edges), [nodes, edges]);
  const simulationHot = useMemo(() => {
    const visibleSteps = simulationSteps.slice(0, simulationStep);
    return {
      nodes: new Set(visibleSteps.map((step) => step.nodeId)),
      edges: new Set(visibleSteps.map((step) => step.edgeId).filter(Boolean)),
    };
  }, [simulationStep, simulationSteps]);
  const simulationTimeline = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]));

    return simulationSteps.map((step, index) => {
      const stepNumber = index + 1;
      const done = index < simulationStep;
      const current = active && index === simulationStep && simulationStep < simulationSteps.length;
      const status = done ? 'done' : current ? 'current' : 'queued';

      if (step.edgeId) {
        const edge = edgeById.get(step.edgeId);
        const sourceNode = nodeById.get(edge?.source);
        const targetNode = nodeById.get(edge?.target || step.nodeId);
        return {
          id: `timeline-${step.edgeId}-${index}`,
          stepNumber,
          status,
          icon: '→',
          title: t('timeline.edge', { label: edge?.label || t('timeline.message') }),
          meta: t('timeline.edgeMeta', {
            source: sourceNode?.data?.title || edge?.source || t('timeline.unknownNode'),
            target: targetNode?.data?.title || edge?.target || t('timeline.unknownNode'),
          }),
        };
      }

      const node = nodeById.get(step.nodeId);
      const title = node?.data?.title || t('timeline.unknownNode');
      const kind = node?.data?.kind || 'custom';
      return {
        id: `timeline-${step.nodeId}-${index}`,
        stepNumber,
        status,
        icon: node?.data?.icon || '•',
        title: t(`timeline.kind.${kind}`, { node: title, defaultValue: t('timeline.kind.custom', { node: title }) }),
        meta: node?.data?.detail || node?.data?.sub || t('timeline.noDetail'),
      };
    });
  }, [active, edges, nodes, simulationStep, simulationSteps, t]);
  const simulationProgress = `${Math.min(simulationStep, simulationSteps.length)}/${simulationSteps.length}`;

  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    if (selectedEdgeId && !edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [edges, selectedEdgeId]);

  useEffect(() => {
    if (!saveNotice) return undefined;
    const timer = window.setTimeout(() => setSaveNotice(false), 1800);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);

  useEffect(() => {
    if (!connectionNotice) return undefined;
    const timer = window.setTimeout(() => setConnectionNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [connectionNotice]);

  useEffect(() => {
    if (!active || isKickoffWorkflow || !simulationSteps.length) {
      setSimulationStep(0);
      return undefined;
    }

    if (!simulationAuto) return undefined;
    if (simulationStep === 0) setSimulationStep(1);

    const timer = window.setInterval(() => {
      setSimulationStep((step) => (step >= simulationSteps.length ? 1 : step + 1));
    }, simulationDelay);

    return () => window.clearInterval(timer);
  }, [active, isKickoffWorkflow, simulationAuto, simulationDelay, simulationStep, simulationSteps.length]);

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      const isEditingText = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;
      if (isEditingText) return;

      const isModKey = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedNode || selectedEdge)) {
        event.preventDefault();
        deleteSelection();
      }
      if (isModKey && key === 'c' && selectedNode) {
        event.preventDefault();
        copySelectedNode();
      }
      if (isModKey && key === 'v' && nodeClipboard) {
        event.preventDefault();
        pasteNode();
      }
      if (isModKey && key === 'd' && selectedNode) {
        event.preventDefault();
        duplicateSelectedNode();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nodeClipboard, selectedEdge, selectedNode]);

  // When the flow is active, light nodes up from real events.
  const lastEvent = feed[feed.length - 1];
  const liveNodes = useMemo(() => {
    if (!active) return nodes;
    if (!isKickoffWorkflow) {
      return nodes.map((n) => ({ ...n, data: { ...n.data, live: simulationHot.nodes.has(n.id) } }));
    }
    const hot = new Set(['hcs10']);
    if (lastEvent?.type === 'offer') hot.add('buyer');
    if (lastEvent?.type === 'agent_reasoning' || lastEvent?.type === 'agent_status') hot.add('seller-agent');
    if (lastEvent?.type === 'agent_verdict') {
      hot.add('seller-agent');
      hot.add('voice');
      if (lastEvent.decision === 'accept') hot.add('escrow');
    }
    return nodes.map((n) => ({ ...n, data: { ...n.data, live: hot.has(n.id) } }));
  }, [nodes, active, isKickoffWorkflow, lastEvent, simulationHot.nodes]);

  const displayEdges = useMemo(() => {
    if (!active && !selectedEdgeId) return edges;
    return edges.map((edge) => {
      const hot = simulationHot.edges.has(edge.id);
      const selected = edge.id === selectedEdgeId;
      return {
        ...edge,
        selected,
        animated: hot || selected,
        style: selected ? selectedEdgeStyle : hot && !isKickoffWorkflow ? activeEdgeStyle : edgeStyle,
        markerEnd: selected ? selectedEdgeMarker : hot && !isKickoffWorkflow ? selectedEdgeMarker : edgeMarker,
      };
    });
  }, [active, edges, isKickoffWorkflow, selectedEdgeId, simulationHot.edges]);

  const activationLabel = active ? `■ ${t('stop')}` : `▶ ${isKickoffWorkflow ? t('listenLive') : t('simulate')}`;
  const activeStatus = isKickoffWorkflow ? t('activeLiveFlow') : t('activeSimulation');
  const saveStateLabel = isKickoffWorkflow
    ? t('liveTemplateSafe')
    : hasUnsavedChanges
      ? draftNotice
        ? t('draftSaved')
        : t('savingDraft')
      : saveNotice
        ? t('savedJustNow')
        : t('savedLocally');
  const saveStateClass = isKickoffWorkflow ? 'live' : hasUnsavedChanges ? (draftNotice ? 'draft' : 'dirty') : 'clean';
  const modeLabel = isKickoffWorkflow ? t('kickoffLiveTemplate') : t('localWorkflow');

  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    const lastOpenedId = readLastOpenedWorkflowId();
    if (!lastOpenedId || lastOpenedId === 'kickoff') return;

    const draft = readDraft();
    const matchingDraft =
      draft && (lastOpenedId === 'draft' || draft.id === lastOpenedId || draft.sourceWorkflowId === lastOpenedId) ? draft : null;

    if (matchingDraft) {
      const draftNodes = cloneNodes(matchingDraft.nodes || []);
      const draftEdges = styleEdges(matchingDraft.edges || []);
      const name = matchingDraft.name || t('untitledWorkflow');
      setActive(false);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setNodeClipboard(null);
      setCurrentWorkflowId(matchingDraft.sourceWorkflowId || null);
      setWorkflowName(name);
      setNodes(draftNodes);
      setEdges(draftEdges);
      setLastCleanSnapshot('');
      setSaveNotice(false);
      setDraftNotice(true);
      setImportError('');
      setConnectionNotice('');
      return;
    }

    const workflow = readWorkflows().find((item) => item.id === lastOpenedId);
    if (!workflow) return;

    const workflowNodes = cloneNodes(workflow.nodes || []);
    const workflowEdges = styleEdges(workflow.edges || []);
    const name = workflow.name || t('untitledWorkflow');
    setActive(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setNodeClipboard(null);
    setCurrentWorkflowId(workflow.id);
    setWorkflowName(name);
    setNodes(workflowNodes);
    setEdges(workflowEdges);
    setLastCleanSnapshot(workflowSnapshot(name, workflowNodes, workflowEdges));
    setSaveNotice(false);
    setDraftNotice(false);
    setImportError('');
    setConnectionNotice('');
  }, [setEdges, setNodes, t]);

  useEffect(() => {
    if (!restoreAttemptedRef.current || isKickoffWorkflow) return undefined;
    if (!hasUnsavedChanges && currentWorkflowId) return undefined;
    if (!nodes.length && !edges.length && !workflowName.trim()) return undefined;

    setDraftNotice(false);
    const timer = window.setTimeout(() => {
      const name = workflowName.trim() || t('untitledWorkflow');
      const saved = saveDraft({
        id: currentWorkflowId || 'draft',
        sourceWorkflowId: currentWorkflowId || null,
        name,
        nodes: cleanNodes(nodes),
        edges: cleanEdges(edges),
      });
      writeLastOpenedWorkflowId(currentWorkflowId || 'draft');
      if (saved) setDraftNotice(true);
    }, 650);

    return () => window.clearTimeout(timer);
  }, [currentWorkflowId, edges, hasUnsavedChanges, isKickoffWorkflow, nodes, t, workflowName]);

  function activate() {
    const nextActive = !active;
    setActive(nextActive);
    if (isKickoffWorkflow) {
      setEdges((eds) => eds.map((e) => ({ ...e, animated: nextActive })));
    } else {
      setSimulationStep(nextActive ? 1 : 0);
      setEdges((eds) => eds.map((e) => ({ ...e, animated: false, style: edgeStyle })));
    }
  }

  function stepSimulation() {
    if (!simulationSteps.length) return;
    setActive(true);
    setSimulationAuto(false);
    setSimulationStep((step) => (step >= simulationSteps.length ? 1 : step + 1));
  }

  function resetSimulation() {
    setActive(false);
    setSimulationAuto(false);
    setSimulationStep(0);
    if (!isKickoffWorkflow) {
      setEdges((eds) => eds.map((e) => ({ ...e, animated: false, style: edgeStyle })));
    }
  }

  function markWorkflowEditable() {
    setActive(false);
    setSimulationStep(0);
    setCurrentWorkflowId((id) => (id === 'kickoff' ? null : id));
    writeLastOpenedWorkflowId(currentWorkflowId === 'kickoff' ? 'draft' : currentWorkflowId || 'draft');
    setConnectionNotice('');
  }

  function loadKickoffTemplate() {
    const templateNodes = cloneNodes(template.nodes);
    const templateEdges = styleEdges(template.edges);
    setActive(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setNodeClipboard(null);
    setCurrentWorkflowId('kickoff');
    writeLastOpenedWorkflowId('kickoff');
    setWorkflowName(template.name);
    setNodes(templateNodes);
    setEdges(templateEdges);
    setLastCleanSnapshot(workflowSnapshot(template.name, templateNodes, templateEdges));
    setSaveNotice(false);
    setDraftNotice(false);
    setImportError('');
    setConnectionNotice('');
  }

  function loadSavedWorkflow(workflow) {
    const workflowNodes = cloneNodes(workflow.nodes || []);
    const workflowEdges = styleEdges(workflow.edges || []);
    const name = workflow.name || t('untitledWorkflow');
    setActive(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setNodeClipboard(null);
    setCurrentWorkflowId(workflow.id);
    writeLastOpenedWorkflowId(workflow.id);
    setWorkflowName(name);
    setNodes(workflowNodes);
    setEdges(workflowEdges);
    setLastCleanSnapshot(workflowSnapshot(name, workflowNodes, workflowEdges));
    setSaveNotice(false);
    setDraftNotice(false);
    setImportError('');
    setConnectionNotice('');
  }

  function loadStudioTemplate(starter) {
    const starterNodes = cloneNodes(starter.nodes);
    const starterEdges = styleEdges(starter.edges);
    setActive(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setNodeClipboard(null);
    setCurrentWorkflowId(null);
    clearDraft();
    writeLastOpenedWorkflowId('draft');
    setWorkflowName(starter.title);
    setNodes(starterNodes);
    setEdges(starterEdges);
    setLastCleanSnapshot('');
    setSaveNotice(false);
    setDraftNotice(false);
    setImportError('');
    setConnectionNotice('');
  }

  function newWorkflow() {
    const name = t('untitledWorkflow');
    setActive(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setNodeClipboard(null);
    setCurrentWorkflowId(null);
    clearDraft();
    writeLastOpenedWorkflowId('draft');
    setWorkflowName(name);
    setNodes([]);
    setEdges([]);
    setLastCleanSnapshot(workflowSnapshot(name, [], []));
    setSaveNotice(false);
    setDraftNotice(false);
    setImportError('');
    setConnectionNotice('');
  }

  function persistWorkflow() {
    const name = workflowName.trim() || t('untitledWorkflow');
    const savedNodes = cleanNodes(nodes);
    const savedEdges = cleanEdges(edges);
    const saved = saveWorkflow({
      id: currentWorkflowId === 'kickoff' ? undefined : currentWorkflowId,
      name,
      nodes: savedNodes,
      edges: savedEdges,
    });
    clearDraft(currentWorkflowId || undefined);
    writeLastOpenedWorkflowId(saved.id);
    setCurrentWorkflowId(saved.id);
    setWorkflowName(saved.name);
    setSavedWorkflows(readWorkflows());
    setLastCleanSnapshot(workflowSnapshot(saved.name, saved.nodes, saved.edges));
    setSaveNotice(true);
    setDraftNotice(false);
    setImportError('');
  }

  function removeWorkflow(event, workflowId) {
    event.stopPropagation();
    if (!window.confirm(t('deleteWorkflowConfirm'))) return;
    const workflows = deleteWorkflow(workflowId);
    setSavedWorkflows(workflows);
    if (currentWorkflowId === workflowId) newWorkflow();
  }

  function exportJson() {
    const workflow = {
      id: currentWorkflowId || `workflow-${Date.now().toString(36)}`,
      name: workflowName.trim() || t('untitledWorkflow'),
      version: '1.0.0',
      network: 'hedera-testnet',
      nodes: cleanNodes(nodes),
      edges: cleanEdges(edges),
    };
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workflow'}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function publishWorkflow() {
    setPublishState('publishing');
    try {
      const payload = {
        id: currentWorkflowId && currentWorkflowId !== 'kickoff' ? currentWorkflowId : undefined,
        name: workflowName.trim() || t('untitledWorkflow'),
        version: '1.0.0',
        network: 'hedera-testnet',
        nodes: cleanNodes(nodes),
        edges: cleanEdges(edges),
      };
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('publish failed');
      setPublishState('done');
      window.setTimeout(() => setPublishState('idle'), 2200);
    } catch {
      setPublishState('error');
      window.setTimeout(() => setPublishState('idle'), 2600);
    }
  }

  async function importJson(event) {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const imported = normalizeImportedWorkflow(parsed, t('untitledWorkflow'));
      const importedNodes = cloneNodes(imported.nodes);
      const importedEdges = styleEdges(imported.edges);

      setActive(false);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setNodeClipboard(null);
      setCurrentWorkflowId(null);
      writeLastOpenedWorkflowId('draft');
      setWorkflowName(imported.name);
      setNodes(importedNodes);
      setEdges(importedEdges);
      setLastCleanSnapshot('');
      setSaveNotice(false);
      setDraftNotice(false);
      setImportError('');
      setConnectionNotice('');
    } catch {
      setImportError(t('importJsonError'));
    }
  }

  function onDragStart(event, paletteNode) {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(paletteNode));
    event.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function onDrop(event) {
    event.preventDefault();
    if (!reactFlowInstance) return;

    const raw = event.dataTransfer.getData('application/reactflow');
    if (!raw) return;

    const paletteNode = JSON.parse(raw);
    const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const id = `${paletteNode.kind}-${Date.now().toString(36)}`;
    const node = {
      id,
      type: 'kickoffNode',
      position,
      data: { ...paletteNode, config: {} },
    };

    setActive(false);
    setCurrentWorkflowId(currentWorkflowId === 'kickoff' ? null : currentWorkflowId);
    setNodes((nds) => nds.concat(node));
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }

  function buildCopiedNode(node, offset = 40) {
    const id = `${node.data?.kind || 'node'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return {
      ...node,
      id,
      selected: false,
      position: {
        x: node.position.x + offset,
        y: node.position.y + offset,
      },
      data: {
        ...node.data,
        config: { ...(node.data?.config || {}) },
        live: false,
        title: `${node.data?.title || t('node')} ${t('copySuffix')}`,
      },
    };
  }

  function copySelectedNode() {
    if (!selectedNode) return;
    setNodeClipboard({
      ...selectedNode,
      position: { ...selectedNode.position },
      data: { ...selectedNode.data, config: { ...(selectedNode.data?.config || {}) }, live: false },
    });
  }

  function duplicateSelectedNode() {
    if (!selectedNode) return;
    const duplicate = buildCopiedNode(selectedNode);
    markWorkflowEditable();
    setNodes((nds) => nds.concat(duplicate));
    setSelectedNodeId(duplicate.id);
    setSelectedEdgeId(null);
  }

  function pasteNode() {
    if (!nodeClipboard) return;
    const pasted = buildCopiedNode(nodeClipboard, selectedNode ? 52 : 40);
    markWorkflowEditable();
    setNodes((nds) => nds.concat(pasted));
    setSelectedNodeId(pasted.id);
    setSelectedEdgeId(null);
  }

  function deleteSelection() {
    if (selectedNode) {
      const nodeId = selectedNode.id;
      markWorkflowEditable();
      setNodes((nds) => nds.filter((node) => node.id !== nodeId));
      setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      return;
    }

    if (selectedEdge) {
      const edgeId = selectedEdge.id;
      markWorkflowEditable();
      setEdges((eds) => eds.filter((edge) => edge.id !== edgeId));
      setSelectedEdgeId(null);
    }
  }

  function updateSelectedNode(field, value) {
    setNodes((nds) =>
      nds.map((node) => (node.id === selectedNodeId ? { ...node, data: { ...node.data, [field]: value } } : node))
    );
  }

  function updateSelectedNodeConfig(field, value) {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                config: {
                  ...(node.data.config || {}),
                  [field]: value,
                },
              },
            }
          : node
      )
    );
  }

  function renderNodeConfigField(field) {
    const value = selectedNode?.data?.config?.[field.key] || '';
    const label = t(`nodeConfig.${field.key}`);
    if (field.type === 'select') {
      return (
        <label className="inspector-field" key={field.key}>
          <span>{label}</span>
          <select value={value} onChange={(event) => updateSelectedNodeConfig(field.key, event.target.value)}>
            <option value="">{t('notSet')}</option>
            {field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (field.type === 'textarea') {
      return (
        <label className="inspector-field" key={field.key}>
          <span>{label}</span>
          <textarea value={value} placeholder={field.placeholder || ''} onChange={(event) => updateSelectedNodeConfig(field.key, event.target.value)} />
        </label>
      );
    }

    return (
      <label className="inspector-field" key={field.key}>
        <span>{label}</span>
        <input value={value} placeholder={field.placeholder || ''} onChange={(event) => updateSelectedNodeConfig(field.key, event.target.value)} />
      </label>
    );
  }

  function updateSelectedEdge(field, value) {
    setEdges((eds) => eds.map((edge) => (edge.id === selectedEdgeId ? { ...edge, [field]: value } : edge)));
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
            {activationLabel}
          </button>
        </div>
      </div>
      <div className="studio-body">
        <div className="studio-sidebar">
          <div className="sidebar-title">{t('templateLibrary')}</div>
          <div className={`template-card ${currentWorkflowId === 'kickoff' ? 'active' : ''}`} onClick={loadKickoffTemplate}>
            <div className="template-name">☕ {t('kickoffTemplate')}</div>
            <div className="template-desc">{template.description}</div>
            <div className="template-meta">8 nodes · 9 edges · hedera-testnet</div>
          </div>
          {studioTemplates.map((starter) => (
            <div className="template-card starter" key={starter.id} onClick={() => loadStudioTemplate(starter)}>
              <div className="template-name">
                {starter.emoji} {starter.title}
              </div>
              <div className="template-desc">{starter.description}</div>
              <div className="template-meta">
                {starter.nodes.length} {t('nodesLabel')} · {starter.edges.length} {t('edgesLabel')} · {t('localStarter')}
              </div>
            </div>
          ))}
          <div className="sidebar-title studio-section-title">{t('myWorkflows')}</div>
          {savedWorkflows.length === 0 ? (
            <div className="studio-empty">{t('noWorkflows')}</div>
          ) : (
            savedWorkflows.map((workflow) => (
              <div
                key={workflow.id}
                className={`template-card workflow-card ${currentWorkflowId === workflow.id ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => loadSavedWorkflow(workflow)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') loadSavedWorkflow(workflow);
                }}
              >
                <span>
                  <div className="template-name">{workflow.name}</div>
                  <div className="template-meta">
                    {workflow.nodes?.length || 0} {t('nodesLabel')} · {workflow.edges?.length || 0} {t('edgesLabel')}
                  </div>
                </span>
                <button className="workflow-delete" onClick={(event) => removeWorkflow(event, workflow.id)} aria-label={t('deleteWorkflow')}>
                  ×
                </button>
              </div>
            ))
          )}
          <div className="studio-actions">
            <input
              className="workflow-name-input"
              value={workflowName}
              onChange={(event) => setWorkflowName(event.target.value)}
              aria-label={t('workflowName')}
            />
            <div className={`save-state ${saveStateClass}`}>
              <span className="save-state-dot" /> {saveStateLabel}
            </div>
            <div className="studio-action-grid">
              <button className="btn-ghost" onClick={newWorkflow}>
                {t('newWorkflow')}
              </button>
              <button className="btn-primary" onClick={persistWorkflow}>
                {t('save')}
              </button>
            </div>
            <div className="studio-secondary-grid">
              <button className="btn-ghost export-btn" onClick={exportJson}>
                {t('exportJson')}
              </button>
              <button className="btn-ghost export-btn" onClick={() => importInputRef.current?.click()}>
                {t('importJson')}
              </button>
            </div>
            <input ref={importInputRef} className="workflow-file-input" type="file" accept="application/json,.json" onChange={importJson} />
            <button
              className={`btn-ghost export-btn publish-btn ${publishState}`}
              onClick={publishWorkflow}
              disabled={publishState === 'publishing'}
            >
              {publishState === 'publishing'
                ? t('publishing')
                : publishState === 'done'
                  ? t('publishedToServer')
                  : publishState === 'error'
                    ? t('publishError')
                    : t('publishWorkflow')}
            </button>
            {importError && <div className="import-error">{importError}</div>}
          </div>
          <div className="sidebar-title studio-section-title">{t('nodePalette')}</div>
          <div className="node-palette">
            {paletteNodes.map((paletteNode) => (
              <div
                key={paletteNode.kind}
                className="palette-item"
                draggable
                onDragStart={(event) => onDragStart(event, paletteNode)}
              >
                <div className="kn-icon palette-icon" style={{ background: `color-mix(in srgb, ${paletteNode.color} 14%, transparent)` }}>
                  {paletteNode.icon}
                </div>
                <div className="palette-copy">
                  <div className="template-name">{paletteNode.title}</div>
                  <div className="template-desc">{paletteNode.sub}</div>
                </div>
              </div>
            ))}
          </div>
          {active && (
            <div className="studio-status">
              <div className="logo-dot" /> {activeStatus}
            </div>
          )}
          {!isKickoffWorkflow && (
            <div className="simulation-controls">
              <div className="sidebar-title">{t('simulationControls')}</div>
              <div className="simulation-control-row">
                <button className="btn-ghost" onClick={resetSimulation}>
                  {t('reset')}
                </button>
                <button className="btn-primary" onClick={stepSimulation}>
                  {t('step')}
                </button>
              </div>
              <label className="simulation-toggle">
                <input type="checkbox" checked={simulationAuto} onChange={(event) => setSimulationAuto(event.target.checked)} />
                <span>{t('autoRun')}</span>
              </label>
              <label className="simulation-speed">
                <span>{t('speed')}</span>
                <input
                  type="range"
                  min="350"
                  max="1400"
                  step="50"
                  value={1750 - simulationDelay}
                  onChange={(event) => setSimulationDelay(1750 - Number(event.target.value))}
                />
              </label>
              <div className="simulation-timeline">
                <div className="timeline-head">
                  <span>{t('simulationTimeline')}</span>
                  <strong>{simulationProgress}</strong>
                </div>
                {simulationTimeline.length === 0 ? (
                  <div className="timeline-empty">{t('simulationTimelineEmpty')}</div>
                ) : (
                  <div className="timeline-list">
                    {simulationTimeline.map((entry) => (
                      <div className={`timeline-item ${entry.status}`} key={entry.id}>
                        <div className="timeline-step">
                          <span>{entry.stepNumber}</span>
                        </div>
                        <div className="timeline-copy">
                          <div className="timeline-title">
                            <span>{entry.icon}</span>
                            {entry.title}
                          </div>
                          <div className="timeline-meta">{entry.meta}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="studio-canvas" onDrop={onDrop} onDragOver={onDragOver}>
          <div className={`workflow-mode-badge ${isKickoffWorkflow ? 'live' : 'local'}`}>
            <span className="save-state-dot" /> {modeLabel}
          </div>
          <ReactFlow
            nodes={liveNodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            connectionLineStyle={selectedEdgeStyle}
            onInit={setReactFlowInstance}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            nodeTypes={nodeTypes}
            fitView
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1C1C2E" gap={22} />
            <Controls />
            <MiniMap pannable zoomable style={{ background: '#0F0F18' }} />
          </ReactFlow>
          {connectionNotice && <div className="connection-notice">{connectionNotice}</div>}
          {selectedNode && (
            <div className="node-inspector">
              <div className="sidebar-title">{t('inspector')}</div>
              <div className="inspector-actions">
                <button className="btn-ghost" onClick={duplicateSelectedNode}>
                  {t('duplicate')}
                </button>
                <button className="btn-ghost" onClick={copySelectedNode}>
                  {t('copy')}
                </button>
                <button className="btn-ghost" onClick={pasteNode} disabled={!nodeClipboard}>
                  {t('paste')}
                </button>
                <button className="btn-ghost danger" onClick={deleteSelection}>
                  {t('delete')}
                </button>
              </div>
              <label className="inspector-field">
                <span>{t('title')}</span>
                <input value={selectedNode.data.title || ''} onChange={(event) => updateSelectedNode('title', event.target.value)} />
              </label>
              <label className="inspector-field">
                <span>{t('subtitle')}</span>
                <input value={selectedNode.data.sub || ''} onChange={(event) => updateSelectedNode('sub', event.target.value)} />
              </label>
              <label className="inspector-field">
                <span>{t('detail')}</span>
                <textarea value={selectedNode.data.detail || ''} onChange={(event) => updateSelectedNode('detail', event.target.value)} />
              </label>
              <div className="inspector-divider">
                <span>{t('nodeSettings')}</span>
                <strong>{selectedNode.data.kind || t('node')}</strong>
              </div>
              <div className="node-config-grid">{selectedNodeConfigFields.map(renderNodeConfigField)}</div>
            </div>
          )}
          {selectedEdge && (
            <div className="node-inspector">
              <div className="sidebar-title">{t('edgeInspector')}</div>
              <div className="inspector-actions single">
                <button className="btn-ghost danger" onClick={deleteSelection}>
                  {t('deleteEdge')}
                </button>
              </div>
              <label className="inspector-field">
                <span>{t('label')}</span>
                <input value={selectedEdge.label || ''} onChange={(event) => updateSelectedEdge('label', event.target.value)} />
              </label>
              <label className="inspector-field">
                <span>{t('source')}</span>
                <input value={selectedEdge.source || ''} readOnly />
              </label>
              <label className="inspector-field">
                <span>{t('target')}</span>
                <input value={selectedEdge.target || ''} readOnly />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
