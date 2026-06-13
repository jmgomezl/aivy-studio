// Set resolver + agent-card records for kickoffseller.eth directly via the ENS
// registry and public resolver (bypassing ensjs's broken Sepolia config).
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, namehash, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const RESOLVER = '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5';
const RPC = 'https://sepolia.drpc.org';
const NAME = process.env.ENS_LABEL ? process.env.ENS_LABEL + '.eth' : 'kickoffseller.eth';
const node = namehash(NAME);

const account = privateKeyToAccount((process.env.EVM_OPERATOR_PRIVATE_KEY.startsWith('0x') ? '' : '0x') + process.env.EVM_OPERATOR_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

const registryAbi = [{ name: 'setResolver', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [] }];
const resolverAbi = [
  { name: 'setAddr', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [] },
  { name: 'setText', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'string' }, { type: 'string' }], outputs: [] },
  { name: 'multicall', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes[]' }], outputs: [{ type: 'bytes[]' }] },
];

const texts = [
  ['description', 'Kickoff seller agent — autonomous specialty-coffee negotiator on Hedera.'],
  ['url', 'https://kickoff.bot'],
  ['com.github', 'jmgomezl/aivy-studio'],
  ['hedera.account', process.env.SELLER_AGENT_ACCOUNT_ID || '0.0.9217340'],
  ['hedera.hcs10.topic', process.env.HCS10_NEGOTIATION_TOPIC || '0.0.9217269'],
  ['agent.role', 'seller'],
  ['agent.framework', 'hedera-agent-kit'],
];

console.log(`[ens] ${NAME} (node ${node.slice(0, 12)}…)`);
// 1. point the name at the public resolver
const r1 = await wallet.writeContract({ address: REGISTRY, abi: registryAbi, functionName: 'setResolver', args: [node, RESOLVER] });
await publicClient.waitForTransactionReceipt({ hash: r1 });
console.log('[ens] resolver set:', r1);

// 2. set address + all text records in one resolver multicall
const calls = [
  encodeFunctionData({ abi: resolverAbi, functionName: 'setAddr', args: [node, account.address] }),
  ...texts.map(([k, v]) => encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [node, k, v] })),
];
const r2 = await wallet.writeContract({ address: RESOLVER, abi: resolverAbi, functionName: 'multicall', args: [calls] });
await publicClient.waitForTransactionReceipt({ hash: r2 });
console.log('[ens] records set:', r2);
console.log(`\n🟢 ${NAME} live with agent card → https://sepolia.app.ens.domains/${NAME}`);
