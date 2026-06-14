// Live ENS resolution — the agent's identity is READ from ENS at runtime, not
// hard-coded. Forward-resolves the agent name → address + its on-chain text
// records (the agent card: description, url, github, role, framework, the Hedera
// account + HCS-10 topic), and reverse-resolves any EVM address → its primary
// .eth name. All reads hit Sepolia at request time; nothing is baked in.
//
// We read the registry → resolver → addr/text directly (viem's UniversalResolver
// path is flaky for this name on Sepolia); this is the proven-reliable route.
import { createPublicClient, http, namehash } from 'viem';
import { sepolia } from 'viem/chains';

const RPC = process.env.ENS_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
const REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const AGENT_NAME = process.env.ERC8004_AGENT_DOMAIN || 'kickoffseller.eth';

// The agent-card text record keys we surface (ENSIP-26-style agent metadata).
const TEXT_KEYS = ['description', 'url', 'com.github', 'avatar', 'agent.role', 'agent.framework', 'hedera.account', 'hedera.hcs10.topic'];

const registryAbi = [{ name: 'resolver', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] }];
const resolverAbi = [
  { name: 'addr', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { name: 'text', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'string' }], outputs: [{ type: 'string' }] },
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'string' }] },
];

const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

// Tiny TTL cache so a busy Arena doesn't hammer the RPC (still live, just throttled).
const cache = new Map();
const TTL_MS = 60_000;
function memo(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = fn().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { val, exp: Date.now() + TTL_MS });
  return val;
}

/** Live-resolve the agent name → address + text records (the on-chain agent card). */
export async function resolveAgent(name = AGENT_NAME) {
  return memo('agent:' + name, async () => {
    const node = namehash(name);
    const resolver = await client.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'resolver', args: [node] });
    if (!resolver || /^0x0+$/.test(resolver)) return { name, resolved: false };
    const [address, ...textVals] = await Promise.all([
      client.readContract({ address: resolver, abi: resolverAbi, functionName: 'addr', args: [node] }).catch(() => null),
      ...TEXT_KEYS.map((k) => client.readContract({ address: resolver, abi: resolverAbi, functionName: 'text', args: [node, k] }).catch(() => '')),
    ]);
    const records = {};
    TEXT_KEYS.forEach((k, i) => { if (textVals[i]) records[k] = textVals[i]; });
    return {
      name,
      resolved: true,
      address: address && !/^0x0+$/.test(address) ? address : null,
      resolver,
      records,
      chain: 'sepolia',
      app: `https://sepolia.app.ens.domains/${name}`,
      resolvedAt: new Date().toISOString(),
    };
  });
}

/** Reverse-resolve an EVM address → its primary .eth name (or null).
 *  Direct read of <addr>.addr.reverse → resolver.name(node), then forward-verify
 *  the name's addr points back to the address (ENSIP-3 reverse record). */
export async function reverseName(address) {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return memo('rev:' + address.toLowerCase(), async () => {
    try {
      const reverseNode = namehash(address.toLowerCase().slice(2) + '.addr.reverse');
      const resolver = await client.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'resolver', args: [reverseNode] });
      if (!resolver || /^0x0+$/.test(resolver)) return null;
      const name = await client.readContract({ address: resolver, abi: resolverAbi, functionName: 'name', args: [reverseNode] });
      if (!name) return null;
      // forward-verify: the claimed name must resolve back to this address
      const fwd = await resolveAgent(name);
      if (fwd?.address && fwd.address.toLowerCase() === address.toLowerCase()) return name;
      return null;
    } catch {
      return null;
    }
  });
}
