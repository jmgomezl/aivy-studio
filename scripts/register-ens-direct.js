// ENS registration calling the CURRENT Sepolia controller directly with its
// real struct ABI (ensjs 4.2.3 sends the old positional args → empty revert).
// Controller: 0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968
// register/makeCommitment take a Registration struct with `label` (no .eth),
// uint8 reverseRecord, and a bytes32 referrer field.
import 'dotenv/config';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { addEnsContracts } from '@ensdomains/ensjs';
import { setRecords, setResolver } from '@ensdomains/ensjs/wallet';
import { randomBytes } from 'node:crypto';

const CONTROLLER = '0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968';
const RESOLVER = '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5';
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const LABEL = process.env.ENS_LABEL || 'kickoffseller';
const NAME = LABEL + '.eth';
const DURATION = 31536000n;
const ZERO32 = '0x' + '00'.repeat(32);

const regTuple = {
  name: 'registration', type: 'tuple', components: [
    { name: 'label', type: 'string' }, { name: 'owner', type: 'address' },
    { name: 'duration', type: 'uint256' }, { name: 'secret', type: 'bytes32' },
    { name: 'resolver', type: 'address' }, { name: 'data', type: 'bytes[]' },
    { name: 'reverseRecord', type: 'uint8' }, { name: 'referrer', type: 'bytes32' },
  ],
};
const abi = [
  { name: 'available', type: 'function', stateMutability: 'view', inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'bool' }] },
  { name: 'rentPrice', type: 'function', stateMutability: 'view', inputs: [{ type: 'string' }, { type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'base', type: 'uint256' }, { name: 'premium', type: 'uint256' }] }] },
  { name: 'makeCommitment', type: 'function', stateMutability: 'pure', inputs: [regTuple], outputs: [{ type: 'bytes32' }] },
  { name: 'commit', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }], outputs: [] },
  { name: 'register', type: 'function', stateMutability: 'payable', inputs: [regTuple], outputs: [] },
  // custom errors so viem decodes the exact revert
  { type: 'error', name: 'CommitmentNotFound', inputs: [{ type: 'bytes32' }] },
  { type: 'error', name: 'CommitmentTooNew', inputs: [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }] },
  { type: 'error', name: 'CommitmentTooOld', inputs: [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }] },
  { type: 'error', name: 'DurationTooShort', inputs: [{ type: 'uint256' }] },
  { type: 'error', name: 'InsufficientValue', inputs: [] },
  { type: 'error', name: 'NameNotAvailable', inputs: [{ type: 'string' }] },
  { type: 'error', name: 'ResolverRequiredForReverseRecord', inputs: [] },
  { type: 'error', name: 'ResolverRequiredWhenDataSupplied', inputs: [] },
  { type: 'error', name: 'UnexpiredCommitmentExists', inputs: [{ type: 'bytes32' }] },
];

const pk = process.env.EVM_OPERATOR_PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
const step = (m) => console.log(`[ens] ${m}`);

async function main() {
  const available = await publicClient.readContract({ address: CONTROLLER, abi, functionName: 'available', args: [LABEL] });
  step(`${NAME} available: ${available}`);
  if (available) {
    const secret = '0x' + randomBytes(32).toString('hex');
    // Register with NO resolver/data to avoid the resolver sub-call that reverts; set records after.
    const reg = { label: LABEL, owner: account.address, duration: DURATION, secret, resolver: '0x0000000000000000000000000000000000000000', data: [], reverseRecord: 0, referrer: ZERO32 };

    const commitment = await publicClient.readContract({ address: CONTROLLER, abi, functionName: 'makeCommitment', args: [reg] });
    step(`commitment: ${commitment}`);
    const ch = await wallet.writeContract({ address: CONTROLLER, abi, functionName: 'commit', args: [commitment] });
    await publicClient.waitForTransactionReceipt({ hash: ch });
    step(`commit confirmed: ${ch}`);

    step('waiting 80s…');
    await new Promise((r) => setTimeout(r, 80000));

    const price = await publicClient.readContract({ address: CONTROLLER, abi, functionName: 'rentPrice', args: [LABEL, DURATION] });
    const value = (price.base + price.premium) * 2n;
    step(`price=${price.base + price.premium} sending=${value}`);

    const rh = await wallet.writeContract({ address: CONTROLLER, abi, functionName: 'register', args: [reg], value });
    await publicClient.waitForTransactionReceipt({ hash: rh });
    step(`🟢 REGISTERED ${NAME}: https://sepolia.etherscan.io/tx/${rh}`);
  }

  // Records via ensjs (resolver write — unaffected by the controller issue).
  const ensWallet = createWalletClient({ account, chain: addEnsContracts(sepolia), transport: http(RPC) });
  step('setting resolver…');
  const resHash = await setResolver(ensWallet, { name: NAME, contract: 'registry', resolver: RESOLVER });
  await publicClient.waitForTransactionReceipt({ hash: resHash });
  step('setting agent-card records…');
  const setHash = await setRecords(ensWallet, {
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
  await publicClient.waitForTransactionReceipt({ hash: setHash });
  step(`records set: ${setHash}`);
  console.log(`\n🟢 ${NAME} live → https://sepolia.app.ens.domains/${NAME}`);
}

main().catch((e) => {
  console.error('[ens] FAILED:', e.shortMessage || e.message);
  // dig out the raw revert selector
  let cur = e, data;
  while (cur && !data) { data = cur.data ?? cur.raw ?? cur.signature; cur = cur.cause; }
  console.error('[ens] raw revert data:', data || '(none surfaced)');
  if (e.metaMessages) console.error('[ens]', e.metaMessages.slice(0, 3).join(' | '));
  process.exit(1);
});
