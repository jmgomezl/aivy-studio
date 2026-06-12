// Tests both lanes of the delegation policy on testnet with real key separation:
//  lane 1: below threshold — agent settles directly from escrow (autonomous)
//  lane 2: above threshold — debits the SELLER VAULT; agent only creates the
//          schedule; it must remain pending until the vault (Ledger) key signs.
import 'dotenv/config';
import { PrivateKey } from '@hashgraph/sdk';
import { escrowClient } from '../agent/escrow.js';
import { settleDeal, approveScheduled, scheduleStatus } from '../agent/delegation.js';

const client = escrowClient();
const seller = process.env.SELLER_AGENT_ACCOUNT_ID;
const operator = process.env.HEDERA_OPERATOR_ID;
const vault = process.env.SELLER_VAULT_ACCOUNT_ID;

const direct = await settleDeal(client, { from: operator, to: seller, amountHbar: 3, negotiationId: 'smoke-direct' });
console.log('lane 1 (direct, agent autonomous):', direct.mode, direct.status);

const sched = await settleDeal(client, { from: vault, to: seller, amountHbar: 60, negotiationId: 'smoke-ledger' });
console.log('lane 2 (scheduled):', sched.mode, 'scheduleId', sched.scheduleId);
let st = await scheduleStatus(client, sched.scheduleId);
console.log('  pending before Ledger signs?', !st.executed);
if (st.executed) { console.error('FAIL: executed without seller key'); process.exit(1); }

const appr = await approveScheduled(client, sched.scheduleId, PrivateKey.fromStringECDSA(process.env.SELLER_VAULT_KEY));
console.log('  seller (Ledger stand-in) signed:', appr.status);
st = await scheduleStatus(client, sched.scheduleId);
console.log('  executed after signature?', st.executed, st.executedAt);
client.close();
