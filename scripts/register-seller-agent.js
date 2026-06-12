// Registers the Kickoff seller agent on HCS-10 (OpenConvAI).
// We create the agent account ourselves so the private key is always under our
// control, then build the HCS-10 topics + HCS-11 profile via the standards-sdk.
// A failure in the remote registry indexing service is tolerated — the on-chain
// agent (account + topics + profile) is what the demo depends on.
import 'dotenv/config';
import { Client, PrivateKey, AccountCreateTransaction, Hbar } from '@hashgraph/sdk';
import {
  HCS10Client,
  AgentBuilder,
  AIAgentType,
  AIAgentCapability,
} from '@hashgraphonline/standards-sdk';
import { readFileSync, writeFileSync } from 'node:fs';

const network = process.env.HEDERA_NETWORK || 'testnet';

// 1. Create the agent account with a key we keep
const sdkClient = Client.forTestnet();
sdkClient.setOperator(
  process.env.HEDERA_OPERATOR_ID,
  PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY)
);
const agentKey = PrivateKey.generateECDSA();
const accountTx = await new AccountCreateTransaction()
  .setKey(agentKey.publicKey)
  .setInitialBalance(new Hbar(20))
  .execute(sdkClient);
const accountId = (await accountTx.getReceipt(sdkClient)).accountId.toString();
console.log('Agent account created:', accountId);
sdkClient.close();

// 2. Build HCS-10 topics + profile for that account
const hcs10 = new HCS10Client({
  network,
  operatorId: accountId,
  operatorPrivateKey: agentKey.toString(),
  logLevel: 'warn',
});

const builder = new AgentBuilder()
  .setName('Kickoff Seller Agent')
  .setAlias('kickoff-seller')
  .setBio(
    'Autonomous seller agent for Kickoff.bot. Negotiates specialty coffee on Hedera: ' +
      'evaluates price and argument quality against an on-chain committed minimum, ' +
      'rewards genuine appreciation, penalizes authority arguments.'
  )
  .setType(AIAgentType.AUTONOMOUS)
  .setCapabilities([
    AIAgentCapability.TEXT_GENERATION,
    AIAgentCapability.TRANSACTION_ANALYTICS,
  ])
  .setModel('gpt-4o')
  .setNetwork(network)
  .setExistingAccount(accountId, agentKey.toString());

let inboundTopicId, outboundTopicId, profileTopicId;
try {
  const result = await hcs10.createAndRegisterAgent(builder);
  const meta = result?.metadata ?? result?.state ?? {};
  inboundTopicId = meta.inboundTopicId;
  outboundTopicId = meta.outboundTopicId;
  profileTopicId = meta.profileTopicId;
  if (!result?.success) {
    console.warn(
      'Remote registry indexing failed (non-fatal):',
      result?.validationErrors || result?.error
    );
  }
} catch (err) {
  console.warn('createAndRegisterAgent threw (checking partial state):', err.message);
  const state = err?.state;
  inboundTopicId = state?.inboundTopicId;
  outboundTopicId = state?.outboundTopicId;
  profileTopicId = state?.profileTopicId;
}

if (!inboundTopicId || !outboundTopicId) {
  console.error('Topic creation failed — cannot continue.');
  process.exit(1);
}

console.log('Seller agent on HCS-10:');
console.log('  account:        ', accountId);
console.log('  inbound topic:  ', inboundTopicId);
console.log('  outbound topic: ', outboundTopicId);
console.log('  profile topic:  ', profileTopicId);

// 3. Persist to .env
let env = readFileSync('.env', 'utf8');
const vars = {
  SELLER_AGENT_ACCOUNT_ID: accountId,
  SELLER_AGENT_PRIVATE_KEY: agentKey.toString(),
  SELLER_AGENT_INBOUND_TOPIC: inboundTopicId,
  SELLER_AGENT_OUTBOUND_TOPIC: outboundTopicId,
  SELLER_AGENT_PROFILE_TOPIC: profileTopicId ?? '',
};
if (!env.includes('SELLER_AGENT_ACCOUNT_ID=')) env += '\n# Seller agent (HCS-10)\n';
for (const [k, v] of Object.entries(vars)) {
  const line = `${k}=${v ?? ''}`;
  env = env.includes(`${k}=`) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), line) : env + line + '\n';
}
writeFileSync('.env', env);
console.log('Wrote seller agent credentials to .env');
