// ENS agent identity — registers an .eth name for a Kickoff agent on Sepolia
// and sets a full agent-card. Minimal, step-logged, robust.
import 'dotenv/config';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { addEnsContracts } from '@ensdomains/ensjs';
import { getAvailable, getPrice } from '@ensdomains/ensjs/public';
import { commitName, registerName, setRecords } from '@ensdomains/ensjs/wallet';
import { randomSecret } from '@ensdomains/ensjs/utils';

const NAME = process.env.ENS_NAME || 'kickoffseller.eth';
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const DURATION = 31536000;

const pk = process.env.EVM_OPERATOR_PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
const chain = addEnsContracts(sepolia);
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const resolverAddress = chain.contracts.ensPublicResolver.address;

const step = (m) => console.log(`[ens] ${m}`);

async function main() {
  step(`resolver: ${resolverAddress}`);
  const available = await getAvailable(publicClient, { name: NAME });
  step(`${NAME} available: ${available}`);

  if (available) {
    const secret = randomSecret();
    // New controller (ensjs 4.2.3) — include resolver so register matches commit.
    const params = { name: NAME, owner: account.address, duration: DURATION, secret, resolverAddress, reverseRecord: false };

    step('commit…');
    const commitHash = await commitName(wallet, params);
    await publicClient.waitForTransactionReceipt({ hash: commitHash });
    step(`commit confirmed: ${commitHash}`);

    step('waiting 70s for commitment to mature…');
    await new Promise((r) => setTimeout(r, 70000));

    const { base, premium } = await getPrice(publicClient, { nameOrNames: NAME, duration: DURATION });
    const value = (base + premium) * 2n;
    step(`price base=${base} premium=${premium} sending=${value}`);

    step('register…');
    const registerHash = await registerName(wallet, { ...params, value });
    await publicClient.waitForTransactionReceipt({ hash: registerHash });
    step(`registered: ${registerHash}`);
  }

  step('set agent-card records…');
  const setHash = await setRecords(wallet, {
    name: NAME,
    resolverAddress,
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

  console.log(`\n🟢 ${NAME} is live → https://sepolia.app.ens.domains/${NAME}`);
}

main().catch((e) => {
  console.error('[ens] FAILED at last logged step:', e.shortMessage || e.message);
  process.exit(1);
});
