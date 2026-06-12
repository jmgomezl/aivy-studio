// Escrow smoke test: release 2 HBAR from escrow to seller agent, verify via mirror node memo
import 'dotenv/config';
import { escrowClient, releaseEscrow } from '../agent/escrow.js';

const client = escrowClient();
const res = await releaseEscrow(client, process.env.SELLER_AGENT_ACCOUNT_ID, 2, 'smoke-escrow-1');
console.log('release:', res.status, res.txId);
client.close();
