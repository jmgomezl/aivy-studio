// ENS registration via the Sepolia TestnetV1PremigrationRegistrar
// (0xdf60c561…) — the registrar ENS actually uses on Sepolia now. It has NO
// commit/reveal: a single register(Registration) call. ensjs is unaware of it.
import 'dotenv/config';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { addEnsContracts } from '@ensdomains/ensjs';
import { setRecords, setResolver } from '@ensdomains/ensjs/wallet';
import { randomBytes } from 'node:crypto';

const CONTROLLER = '0xdf60c561ca35ad3c89d24bba854654b1c3477078';
const RESOLVER = '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5';
const RPC = 'https://sepolia.drpc.org';
const LABEL = process.env.ENS_LABEL || 'kickoffseller';
const NAME = LABEL + '.eth';
const ZERO32 = '0x' + '00'.repeat(32);

const regTuple = { name: 'registration', type: 'tuple', components: [
  { name: 'label', type: 'string' }, { name: 'owner', type: 'address' },
  { name: 'duration', type: 'uint256' }, { name: 'secret', type: 'bytes32' },
  { name: 'resolver', type: 'address' }, { name: 'data', type: 'bytes[]' },
  { name: 'reverseRecord', type: 'uint8' }, { name: 'referrer', type: 'bytes32' },
]};
const abi = [{ name: 'register', type: 'function', stateMutability: 'payable', inputs: [regTuple], outputs: [] }];

const account = privateKeyToAccount((process.env.EVM_OPERATOR_PRIVATE_KEY.startsWith('0x') ? '' : '0x') + process.env.EVM_OPERATOR_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
const step = (m) => console.log(`[ens] ${m}`);

const reg = {
  label: LABEL, owner: account.address, duration: 31536000n,
  secret: '0x' + randomBytes(32).toString('hex'),
  resolver: '0x0000000000000000000000000000000000000000', data: [], reverseRecord: 0, referrer: ZERO32,
};

async function tryRegister(value) {
  const hash = await wallet.writeContract({ address: CONTROLLER, abi, functionName: 'register', args: [reg], value });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function main() {
  step(`registering ${NAME} via premigration registrar…`);
  let hash;
  for (const v of [0n, 4000000000000000n, 32000000000000000n]) { // 0, 0.004, 0.032 ETH
    try { hash = await tryRegister(v); step(`🟢 REGISTERED with value ${v}: https://sepolia.etherscan.io/tx/${hash}`); break; }
    catch (e) { step(`value ${v} → ${(e.shortMessage || e.message).slice(0, 70)}`); }
  }
  if (!hash) { step('FAILED all value attempts'); process.exit(1); }

  // resolver + agent-card records
  const ensWallet = createWalletClient({ account, chain: addEnsContracts(sepolia), transport: http(RPC) });
  step('setting resolver…');
  await publicClient.waitForTransactionReceipt({ hash: await setResolver(ensWallet, { name: NAME, contract: 'registry', resolver: RESOLVER }) });
  step('setting agent-card records…');
  const rec = await setRecords(ensWallet, {
    name: NAME, resolverAddress: RESOLVER,
    coins: [{ coin: 'eth', value: account.address }],
    texts: [
      { key: 'description', value: 'Kickoff seller agent — autonomous specialty-coffee negotiator on Hedera.' },
      { key: 'url', value: 'https://kickoff.bot' },
      { key: 'com.github', value: 'jmgomezl/aivy-studio' },
      { key: 'hedera.account', value: process.env.SELLER_AGENT_ACCOUNT_ID || '0.0.9217340' },
      { key: 'hedera.hcs10.topic', value: process.env.HCS10_NEGOTIATION_TOPIC || '0.0.9217269' },
      { key: 'agent.role', value: 'seller' },
      { key: 'agent.framework', value: 'hedera-agent-kit' },
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: rec });
  step(`🟢 ${NAME} live → https://sepolia.app.ens.domains/${NAME}`);
}

main().catch((e) => { console.error('[ens] FAILED:', e.shortMessage || e.message); process.exit(1); });
