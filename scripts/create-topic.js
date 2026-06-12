// Creates the HCS-10 negotiation topic for Kickoff.bot and writes its ID to .env
import 'dotenv/config';
import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from '@hashgraph/sdk';
import { readFileSync, writeFileSync } from 'node:fs';

const { HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_NETWORK } = process.env;
if (!HEDERA_OPERATOR_ID || !HEDERA_OPERATOR_KEY) {
  throw new Error('Missing HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY in .env');
}

const client =
  HEDERA_NETWORK === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
const operatorKey = PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY);
client.setOperator(HEDERA_OPERATOR_ID, operatorKey);

// HCS-10 topic memo format: hcs-10:<indexed>:<ttl>:<type>
// type 1 = inbound communication topic
const tx = await new TopicCreateTransaction()
  .setTopicMemo('hcs-10:0:60:1')
  .setSubmitKey(operatorKey.publicKey)
  .setAdminKey(operatorKey.publicKey)
  .execute(client);

const receipt = await tx.getReceipt(client);
const topicId = receipt.topicId.toString();
console.log('HCS-10 negotiation topic created:', topicId);

// Smoke-test: submit and confirm a first message
const msg = await new TopicMessageSubmitTransaction()
  .setTopicId(topicId)
  .setMessage(
    JSON.stringify({
      p: 'hcs-10',
      op: 'message',
      data: 'kickoff.bot negotiation channel initialized',
    })
  )
  .execute(client);
await msg.getReceipt(client);
console.log('First message confirmed on topic.');

// Persist topic id into .env
const env = readFileSync('.env', 'utf8');
writeFileSync(
  '.env',
  env.replace(/^HCS10_NEGOTIATION_TOPIC=.*$/m, `HCS10_NEGOTIATION_TOPIC=${topicId}`)
);
console.log('Wrote HCS10_NEGOTIATION_TOPIC to .env');

client.close();
