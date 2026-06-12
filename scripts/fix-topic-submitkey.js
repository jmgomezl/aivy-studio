import 'dotenv/config';
import { Client, PrivateKey, KeyList, TopicUpdateTransaction } from '@hashgraph/sdk';

const client = Client.forTestnet();
const opKey = PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY);
client.setOperator(process.env.HEDERA_OPERATOR_ID, opKey);

const agentKey = PrivateKey.fromStringECDSA(process.env.SELLER_AGENT_PRIVATE_KEY);
const submitKeys = new KeyList([opKey.publicKey, agentKey.publicKey], 1); // 1-of-2

const tx = await new TopicUpdateTransaction()
  .setTopicId(process.env.HCS10_NEGOTIATION_TOPIC)
  .setSubmitKey(submitKeys)
  .execute(client);
await tx.getReceipt(client);
console.log('Topic submitKey updated to 1-of-2 (operator, seller agent)');
client.close();
