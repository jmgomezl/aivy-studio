// Server-side DRY-RUN executor — Phase 3. Takes a validated workflow graph and
// produces a deterministic timeline of SIMULATED events, in the same shape the
// live WS feed uses, WITHOUT touching Hedera, the topic poller, /api/offer, or
// the seller agent. Every emitted event carries simulated:true so it can never
// be mistaken for a real chain event. This is the "Studio runs your graph"
// wedge: it proves the schema → registry → executor path with no side effects.
//
// The execution order mirrors the canvas buildSimulationSteps (Studio.jsx): a
// breadth-first walk from in-degree-0 roots, children ordered by canvas
// position (x then y), so the server timeline matches what the user sketched.

// Maps each node kind to the live event vocabulary + a plain-English summary of
// what the node WOULD do when run for real. Kinds are the validated set from
// workflow-schema.js (palette kinds + kickoff-template descriptive kinds).
const KIND_EVENT = {
  input: { type: 'offer', verb: 'submits an offer (price + argument)' },
  human: { type: 'offer', verb: 'captures human input and forwards it' },
  agent: { type: 'agent_reasoning', verb: 'evaluates the offer against policy and reasons' },
  hcs10: { type: 'message', verb: 'publishes the message to the HCS-10 topic' },
  transport: { type: 'message', verb: 'relays the message via HCS-10' },
  contract: { type: 'reveal', verb: 'checks / reveals the on-chain commitment' },
  escrow: { type: 'settlement', verb: 'locks or releases escrowed funds' },
  settlement: { type: 'settlement', verb: 'settles the deal on-chain' },
  approval: { type: 'approval_gate', verb: 'awaits the approval threshold' },
  policy: { type: 'approval_gate', verb: 'applies the policy / Ledger gate' },
  scheduled: { type: 'scheduled_tx', verb: 'queues a scheduled transaction' },
  voice: { type: 'voice', verb: 'speaks the verdict (ElevenLabs)' },
  output: { type: 'voice', verb: 'delivers the output notification' },
  uniswap: { type: 'swap', verb: 'executes a token swap' },
  openclaw: { type: 'connector_task', verb: 'runs an external OpenClaw agent task' },
  x402: { type: 'paid_resource', verb: 'prepares an x402 paid resource request' },
  ens: { type: 'identity_resolution', verb: 'resolves ENS agent identity and records' },
  custom: { type: 'custom', verb: 'calls the configured external service' },
};

/** Deterministic execution order: BFS from in-degree-0 roots, children sorted by position. */
function executionOrder(nodes, edges) {
  if (!nodes.length) return [];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map(nodes.map((n) => [n.id, []]));

  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.get(edge.source).push(edge);
  }

  const byPosition = (a, b) =>
    (a.position?.x || 0) - (b.position?.x || 0) || (a.position?.y || 0) - (b.position?.y || 0);

  for (const list of outgoing.values()) {
    list.sort((a, b) => byPosition(byId.get(a.target), byId.get(b.target)));
  }

  const roots = nodes.filter((n) => !incoming.get(n.id)).sort(byPosition);
  const queue = roots.length ? [...roots] : [...nodes].sort(byPosition);
  const seen = new Set();
  const order = [];

  while (queue.length) {
    const node = queue.shift();
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    order.push(node);
    for (const edge of outgoing.get(node.id) || []) {
      if (!seen.has(edge.target)) queue.push(byId.get(edge.target));
    }
  }

  // Any disconnected nodes the BFS never reached, appended in position order.
  for (const node of [...nodes].sort(byPosition)) {
    if (!seen.has(node.id)) order.push(node);
  }

  return order;
}

/**
 * Run a dry-run of a validated workflow. Returns a deterministic timeline of
 * simulated events. Pure: no I/O, no chain, no randomness in the event content.
 */
export function executeDryRun(workflow, { runId } = {}) {
  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];

  const incomingBy = new Map(nodes.map((n) => [n.id, []]));
  const outgoingBy = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    outgoingBy.get(edge.source)?.push(edge.target);
    incomingBy.get(edge.target)?.push(edge.source);
  }

  const order = executionOrder(nodes, edges);
  const steps = order.map((node, i) => {
    const kind = node.data?.kind || 'custom';
    const mapping = KIND_EVENT[kind] || KIND_EVENT.custom;
    const title = node.data?.title || node.id;
    return {
      runId,
      step: i + 1,
      simulated: true,
      nodeId: node.id,
      kind,
      type: mapping.type,
      title,
      icon: node.data?.icon || '•',
      summary: `${title} ${mapping.verb}`,
      incomingFrom: incomingBy.get(node.id) || [],
      outgoingTo: outgoingBy.get(node.id) || [],
    };
  });

  return {
    runId,
    workflowName: workflow.name || 'Untitled workflow',
    nodeCount: nodes.length,
    edgeCount: edges.length,
    steps,
  };
}
