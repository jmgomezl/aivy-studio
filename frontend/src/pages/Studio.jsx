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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from 'react-i18next';
import { useNegotiationFeed } from '../lib/useNegotiation.js';
import KickoffNode from '../components/nodes/KickoffNode.jsx';
import template from '../../../templates/kickoff.json';
import { toggleLang } from '../i18n';
import { deleteWorkflow, readWorkflows, saveWorkflow } from '../lib/workflowStore.js';

const nodeTypes = { kickoffNode: KickoffNode };

const edgeStyle = { stroke: '#1C1C2E', strokeWidth: 1.5 };
const edgeLabelStyle = { fill: '#55556A', fontFamily: 'Space Mono', fontSize: 9 };
const edgeLabelBgStyle = { fill: '#0F0F18' };

function styleEdges(edges, animated = false) {
  return edges.map((edge) => ({
    ...edge,
    animated,
    style: edgeStyle,
    labelStyle: edgeLabelStyle,
    labelBgStyle: edgeLabelBgStyle,
  }));
}

function cloneNodes(nodes) {
  return nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    data: { ...node.data, live: false },
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

  const initialNodes = useMemo(() => cloneNodes(template.nodes), []);
  const initialEdges = useMemo(() => styleEdges(template.edges), []);
  const initialSnapshot = useMemo(() => workflowSnapshot(template.name, initialNodes, initialEdges), [initialEdges, initialNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [lastCleanSnapshot, setLastCleanSnapshot] = useState(initialSnapshot);
  const [saveNotice, setSaveNotice] = useState(false);
  const [importError, setImportError] = useState('');
  const onConnect = useCallback(
    (connection) => {
      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = nodes.find((node) => node.id === connection.target);
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `edge-${connection.source}-${connection.target}-${Date.now().toString(36)}`,
            label: defaultEdgeLabel(sourceNode, targetNode),
            animated: active,
            style: edgeStyle,
            labelStyle: edgeLabelStyle,
            labelBgStyle: edgeLabelBgStyle,
          },
          eds
        )
      );
    },
    [active, nodes, setEdges]
  );

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId), [edges, selectedEdgeId]);
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
    if (!active || isKickoffWorkflow) return edges;
    return edges.map((edge) => {
      const hot = simulationHot.edges.has(edge.id);
      return {
        ...edge,
        animated: hot,
        style: hot ? { ...edgeStyle, stroke: '#00FF87', strokeWidth: 2 } : edgeStyle,
      };
    });
  }, [active, edges, isKickoffWorkflow, simulationHot.edges]);

  const activationLabel = active ? `■ ${t('stop')}` : `▶ ${isKickoffWorkflow ? t('listenLive') : t('simulate')}`;
  const activeStatus = isKickoffWorkflow ? t('activeLiveFlow') : t('activeSimulation');
  const saveStateLabel = hasUnsavedChanges ? t('unsavedChanges') : saveNotice ? t('savedJustNow') : t('saved');
  const modeLabel = isKickoffWorkflow ? t('kickoffLiveTemplate') : t('localWorkflow');

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

  function loadKickoffTemplate() {
    const templateNodes = cloneNodes(template.nodes);
    const templateEdges = styleEdges(template.edges);
    setActive(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setCurrentWorkflowId('kickoff');
    setWorkflowName(template.name);
    setNodes(templateNodes);
    setEdges(templateEdges);
    setLastCleanSnapshot(workflowSnapshot(template.name, templateNodes, templateEdges));
    setSaveNotice(false);
    setImportError('');
  }

  function loadSavedWorkflow(workflow) {
    const workflowNodes = cloneNodes(workflow.nodes || []);
    const workflowEdges = styleEdges(workflow.edges || []);
    const name = workflow.name || t('untitledWorkflow');
    setActive(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setCurrentWorkflowId(workflow.id);
    setWorkflowName(name);
    setNodes(workflowNodes);
    setEdges(workflowEdges);
    setLastCleanSnapshot(workflowSnapshot(name, workflowNodes, workflowEdges));
    setSaveNotice(false);
    setImportError('');
  }

  function newWorkflow() {
    const name = t('untitledWorkflow');
    setActive(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setCurrentWorkflowId(null);
    setWorkflowName(name);
    setNodes([]);
    setEdges([]);
    setLastCleanSnapshot(workflowSnapshot(name, [], []));
    setSaveNotice(false);
    setImportError('');
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
    setCurrentWorkflowId(saved.id);
    setWorkflowName(saved.name);
    setSavedWorkflows(readWorkflows());
    setLastCleanSnapshot(workflowSnapshot(saved.name, saved.nodes, saved.edges));
    setSaveNotice(true);
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
      setCurrentWorkflowId(null);
      setWorkflowName(imported.name);
      setNodes(importedNodes);
      setEdges(importedEdges);
      setLastCleanSnapshot('');
      setSaveNotice(false);
      setImportError('');
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
      data: { ...paletteNode },
    };

    setActive(false);
    setCurrentWorkflowId(currentWorkflowId === 'kickoff' ? null : currentWorkflowId);
    setNodes((nds) => nds.concat(node));
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }

  function updateSelectedNode(field, value) {
    setNodes((nds) =>
      nds.map((node) => (node.id === selectedNodeId ? { ...node, data: { ...node.data, [field]: value } } : node))
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
          <div className="template-card ghost">
            <div className="template-name">🏷️ Auction House</div>
            <div className="template-desc">{t('comingSoon')}</div>
          </div>
          <div className="template-card ghost">
            <div className="template-name">🛒 Supply Negotiator</div>
            <div className="template-desc">{t('comingSoon')}</div>
          </div>
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
            <div className={`save-state ${hasUnsavedChanges ? 'dirty' : 'clean'}`}>
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
          {selectedNode && (
            <div className="node-inspector">
              <div className="sidebar-title">{t('inspector')}</div>
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
            </div>
          )}
          {selectedEdge && (
            <div className="node-inspector">
              <div className="sidebar-title">{t('edgeInspector')}</div>
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
