// Sends a test offer to the negotiation topic as the operator (acting as buyer)
import 'dotenv/config';
import { Client, PrivateKey, TopicMessageSubmitTransaction } from '@hashgraph/sdk';

const client = Client.forTestnet();
client.setOperator(process.env.HEDERA_OPERATOR_ID, PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY));

const offer = {
  p: 'hcs-10', op: 'message', type: 'offer',
  negotiationId: process.argv[2] || 'test-1',
  buyer: process.env.HEDERA_OPERATOR_ID,
  price: Number(process.argv[3] || 30),
  argument: process.argv[4] || 'I fell in love with washed Geisha at a farm in Quindío — the jasmine notes changed how I taste coffee. I brew V60 every morning and this lot deserves a careful hand.',
};
const tx = await new TopicMessageSubmitTransaction()
  .setTopicId(process.env.HCS10_NEGOTIATION_TOPIC)
  .setMessage(JSON.stringify(offer))
  .execute(client);
await tx.getReceipt(client);
console.log('Offer submitted:', offer.negotiationId, offer.price, 'HBAR');
client.close();
