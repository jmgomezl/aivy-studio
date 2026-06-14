// ENS subname registry for the agent fleet — every managed-wallet identity gets
// a real <label>.kickoffseller.eth subname, resolving to its EVM address with
// agent metadata in text records. The parent name is owned directly by the
// operator (unwrapped), so we mint with registry.setSubnodeRecord + set records
// on the public resolver. This is "a subname registry for an agent fleet": agents
// get persistent, human-readable, on-chain identities and can discover each other.
//
// Best-effort + gated by ENS_SUBNAMES_ENABLED. Operator pays gas on Sepolia.
import { createPublicClient, createWalletClient, http, namehash, keccak256, toHex, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const RPC = process.env.ENS_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
const REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const RESOLVER = process.env.ENS_RESOLVER || '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5';
const PARENT = process.env.ERC8004_AGENT_DOMAIN || 'kickoffseller.eth';

const registryAbi = [
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { name: 'setSubnodeRecord', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'uint64' }], outputs: [] },
];
const resolverAbi = [
  { name: 'addr', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { name: 'setAddr', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [] },
  { name: 'setText', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'string' }, { type: 'string' }], outputs: [] },
  { name: 'multicall', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes[]' }], outputs: [{ type: 'bytes[]' }] },
];

export function subnamesEnabled() {
  return process.env.ENS_SUBNAMES_ENABLED === 'true' && !!process.env.EVM_OPERATOR_PRIVATE_KEY;
}

function clients() {
  const pk = (process.env.EVM_OPERATOR_PRIVATE_KEY.startsWith('0x') ? '' : '0x') + process.env.EVM_OPERATOR_PRIVATE_KEY;
  const account = privateKeyToAccount(pk);
  return {
    account,
    pub: createPublicClient({ chain: sepolia, transport: http(RPC) }),
    wallet: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
  };
}

function sanitizeLabel(raw, fallback) {
  const s = String(raw || '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  return s || fallback;
}

/**
 * Mint (or update) <label>.kickoffseller.eth → address with agent text records.
 * Returns { subname, txHash } or null on failure / disabled.
 */
export async function mintSubname({ label, address, role = 'seller', hederaAccount, description }) {
  if (!subnamesEnabled()) return null;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  try {
    const { account, pub, wallet } = clients();
    const parentNode = namehash(PARENT);
    let lbl = sanitizeLabel(label, 'agent' + address.slice(-4).toLowerCase());

    // Collision: if the subname exists and points elsewhere, suffix it with the addr tail.
    let subnode = namehash(`${lbl}.${PARENT}`);
    const existing = await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'owner', args: [subnode] });
    if (existing && !/^0x0+$/.test(existing)) {
      const cur = await pub.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'addr', args: [subnode] }).catch(() => null);
      if (cur && cur.toLowerCase() === address.toLowerCase()) {
        return { subname: `${lbl}.${PARENT}`, txHash: null, already: true }; // idempotent
      }
      lbl = `${lbl}-${address.slice(-4).toLowerCase()}`;
      subnode = namehash(`${lbl}.${PARENT}`);
    }
    const subname = `${lbl}.${PARENT}`;

    // 1. create the subnode owned by the operator, pointed at the public resolver
    const h1 = await wallet.writeContract({
      address: REGISTRY, abi: registryAbi, functionName: 'setSubnodeRecord',
      args: [parentNode, keccak256(toHex(lbl)), account.address, RESOLVER, 0n],
    });
    await pub.waitForTransactionReceipt({ hash: h1 });

    // 2. set the address + agent metadata records in one resolver multicall
    const texts = [
      ['agent.role', role],
      ['agent.framework', 'hedera-agent-kit'],
      ['agent.parent', PARENT],
      ...(hederaAccount ? [['hedera.account', String(hederaAccount)]] : []),
      ['description', description || `Kickoff fleet agent — managed identity under ${PARENT}.`],
    ];
    const calls = [
      encodeFunctionData({ abi: resolverAbi, functionName: 'setAddr', args: [subnode, address] }),
      ...texts.map(([k, v]) => encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [subnode, k, v] })),
    ];
    const h2 = await wallet.writeContract({ address: RESOLVER, abi: resolverAbi, functionName: 'multicall', args: [calls] });
    await pub.waitForTransactionReceipt({ hash: h2 });

    console.log(`[ens-subname] minted ${subname} → ${address}`);
    return { subname, txHash: h2 };
  } catch (err) {
    console.warn('[ens-subname] mint failed (identity stands):', err.message);
    return null;
  }
}
