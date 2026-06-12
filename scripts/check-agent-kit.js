// Verifies Hedera Agent Kit initializes against the operator account
import 'dotenv/config';
import { Client, PrivateKey, AccountBalanceQuery } from '@hashgraph/sdk';
import { HederaLangchainToolkit, coreQueriesPlugin } from 'hedera-agent-kit';

const { HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY } = process.env;
const client = Client.forTestnet();
client.setOperator(HEDERA_OPERATOR_ID, PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY));

const balance = await new AccountBalanceQuery()
  .setAccountId(HEDERA_OPERATOR_ID)
  .execute(client);
console.log(`Operator ${HEDERA_OPERATOR_ID} balance: ${balance.hbars.toString()}`);

const toolkit = new HederaLangchainToolkit({
  client,
  configuration: { plugins: [coreQueriesPlugin] },
});
const tools = toolkit.getTools();
console.log(`Hedera Agent Kit initialized — ${tools.length} tools available:`);
for (const t of tools) console.log('  -', t.name);

client.close();
