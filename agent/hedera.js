// Hedera helpers for the agent engine.
// Reads go through the Mirror Node (free, no rate-limit pain — lesson A).
// Writes go through the SDK with the agent's own account (lesson C).
import {
  Client,
  PrivateKey,
  TopicMessageSubmitTransaction,
} from '@hashgraph/sdk';

const MIRROR =
  process.env.MIRROR_NODE_URL || 'https://testnet.mirrornode.hedera.com';

export function agentClient() {
  const client = Client.forTestnet();
  client.setOperator(
    process.env.SELLER_AGENT_ACCOUNT_ID,
    PrivateKey.fromStringECDSA(process.env.SELLER_AGENT_PRIVATE_KEY)
  );
  return client;
}

/** Fetch topic messages after a sequence number, decoded as JSON when possible. */
export async function fetchTopicMessages(topicId, afterSequence = 0, limit = 50) {
  // Mirror node rejects `gt:0` — omit the sequence filter on the first poll.
  const seqFilter = afterSequence > 0 ? `sequencenumber=gt:${afterSequence}&` : '';
  const url = `${MIRROR}/api/v1/topics/${topicId}/messages?${seqFilter}limit=${limit}&order=asc`;
  const res = await fetch(url);
  if (!res.ok) {
    // Transient mirror hiccups must not kill the poll loop.
    console.warn(`[mirror] HTTP ${res.status} on ${topicId}`);
    return [];
  }
  const data = await res.json();
  return (data.messages || []).map((m) => {
    const raw = Buffer.from(m.message, 'base64').toString('utf8');
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {}
    return { sequence: m.sequence_number, consensusAt: m.consensus_timestamp, raw, json };
  });
}

/** Publish a JSON payload to a topic from the agent's account. */
export async function publishMessage(client, topicId, payload) {
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(JSON.stringify({ p: 'hcs-10', op: 'message', ...payload }))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  return receipt.topicSequenceNumber?.toString();
}
