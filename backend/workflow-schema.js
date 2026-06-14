// Server-side workflow schema — single source of truth for what a Studio
// workflow graph must look like before the backend will accept it. Mirrors the
// frontend's normalizeImportedWorkflow (Studio.jsx) so a graph that imports in
// the canvas validates here too, plus a `kind` allow-list the canvas doesn't
// enforce. Phase 1: validate + canonicalize only — nothing here executes a graph.

// Node kinds the runtime knows about. Anything else is coerced to 'custom'
// (matching the canvas import behavior) rather than rejected, so unknown nodes
// round-trip instead of blocking a publish. Includes both palette kinds and the
// descriptive kinds used by the built-in kickoff template.
export const KNOWN_KINDS = new Set([
  // palette
  'agent', 'hcs10', 'escrow', 'contract', 'approval', 'voice', 'human', 'scheduled', 'uniswap', 'openclaw', 'x402', 'custom',
  // kickoff template descriptive kinds
  'input', 'transport', 'settlement', 'policy', 'output',
]);

const MAX_NODES = 200;
const MAX_EDGES = 400;

class WorkflowValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WorkflowValidationError';
    this.code = code;
  }
}

function str(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * Validate + canonicalize a raw workflow graph. Throws WorkflowValidationError
 * with a stable `code` on bad input; returns a clean, minimal workflow object on
 * success (no styling, no transient UI fields).
 */
export function validateWorkflow(raw, { fallbackName = 'Untitled workflow' } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorkflowValidationError('workflow must be an object', 'not-an-object');
  }
  if (!Array.isArray(raw.nodes)) {
    throw new WorkflowValidationError('workflow.nodes must be an array', 'missing-nodes');
  }
  if (!Array.isArray(raw.edges)) {
    throw new WorkflowValidationError('workflow.edges must be an array', 'missing-edges');
  }
  if (raw.nodes.length > MAX_NODES) {
    throw new WorkflowValidationError(`too many nodes (max ${MAX_NODES})`, 'too-many-nodes');
  }
  if (raw.edges.length > MAX_EDGES) {
    throw new WorkflowValidationError(`too many edges (max ${MAX_EDGES})`, 'too-many-edges');
  }

  const nodeIds = new Set();
  const nodes = raw.nodes.map((node, index) => {
    const id = str(node?.id, `node-${index + 1}`);
    if (nodeIds.has(id)) {
      throw new WorkflowValidationError(`duplicate node id: ${id}`, 'duplicate-node');
    }
    nodeIds.add(id);

    const pos = node?.position || {};
    const data = node?.data || {};
    const rawKind = str(data.kind, 'custom');
    const kind = KNOWN_KINDS.has(rawKind) ? rawKind : 'custom';

    const config =
      data.config && typeof data.config === 'object' && !Array.isArray(data.config)
        ? Object.fromEntries(
            Object.entries(data.config)
              .map(([k, v]) => [k, String(v ?? '')])
              .filter(([, v]) => v.trim())
          )
        : {};

    return {
      id,
      type: 'kickoffNode',
      position: {
        x: Number.isFinite(Number(pos.x)) ? Number(pos.x) : index * 220,
        y: Number.isFinite(Number(pos.y)) ? Number(pos.y) : 120,
      },
      data: {
        icon: str(data.icon, '🤖'),
        color: str(data.color, '#A78BFA'),
        title: str(data.title, `Node ${index + 1}`),
        sub: typeof data.sub === 'string' ? data.sub : '',
        detail: typeof data.detail === 'string' ? data.detail : '',
        kind,
        config,
      },
    };
  });

  const edgeIds = new Set();
  const edges = raw.edges.map((edge, index) => {
    if (!nodeIds.has(edge?.source) || !nodeIds.has(edge?.target)) {
      throw new WorkflowValidationError(
        `edge references unknown node: ${edge?.source} → ${edge?.target}`,
        'invalid-edge'
      );
    }
    let id = str(edge?.id, `edge-${edge.source}-${edge.target}-${index + 1}`);
    if (edgeIds.has(id)) id = `${id}-${index + 1}`;
    edgeIds.add(id);

    return {
      id,
      source: edge.source,
      target: edge.target,
      ...(str(edge?.sourceHandle) ? { sourceHandle: edge.sourceHandle.trim() } : {}),
      ...(str(edge?.targetHandle) ? { targetHandle: edge.targetHandle.trim() } : {}),
      ...(str(edge?.label) ? { label: edge.label.trim() } : {}),
    };
  });

  return {
    name: str(raw.name, fallbackName),
    version: str(raw.version, '1.0.0'),
    network: str(raw.network, 'hedera-testnet'),
    nodes,
    edges,
  };
}

export { WorkflowValidationError };
