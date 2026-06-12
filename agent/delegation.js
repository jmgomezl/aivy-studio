// Ledger delegation policy via Hedera Scheduled Transactions.
//
// The escrow account's key is a 1-of-2 KeyList (treasury key, agent key) so the
// agent can settle deals autonomously — but the agent engine enforces a hard
// threshold: at or below LEDGER_THRESHOLD_HBAR it executes the transfer
// directly (the pre-authorized lane); above it, it only CREATES a scheduled
// transaction, which stays pending on-chain until the seller's hardware key
// co-signs it (ScheduleSignTransaction). The Ledger intervenes exactly when
// the policy says so, and never blocks the demo flow.
import {
  TransferTransaction,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  ScheduleInfoQuery,
  Hbar,
  PrivateKey,
} from '@hashgraph/sdk';

export const LEDGER_THRESHOLD_HBAR = Number(process.env.LEDGER_THRESHOLD_HBAR || 50);

/**
 * Settle an accepted deal under the delegation policy.
 * @returns {Promise<{mode:'direct',txId,status} | {mode:'scheduled',scheduleId,scheduledTxId}>}
 */
export async function settleDeal(client, { from, to, amountHbar, negotiationId }) {
  const transfer = new TransferTransaction()
    .addHbarTransfer(from, new Hbar(-amountHbar))
    .addHbarTransfer(to, new Hbar(amountHbar))
    .setTransactionMemo(`kickoff:settle:${negotiationId}`);

  if (amountHbar <= LEDGER_THRESHOLD_HBAR) {
    const tx = await transfer.execute(client);
    const receipt = await tx.getReceipt(client);
    return { mode: 'direct', txId: tx.transactionId.toString(), status: receipt.status.toString() };
  }

  // Above threshold: schedule it — executes only once the seller key signs.
  const scheduleTx = await new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setScheduleMemo(`kickoff:ledger-approval:${negotiationId}`)
    .execute(client);
  const receipt = await scheduleTx.getReceipt(client);
  return {
    mode: 'scheduled',
    scheduleId: receipt.scheduleId.toString(),
    scheduledTxId: receipt.scheduledTransactionId?.toString(),
  };
}

/**
 * Seller-side approval of a pending above-threshold deal.
 * In production `sellerKey` lives on the Ledger (the SDK signs via the
 * hardware wallet transport); for tests it is a software PrivateKey.
 */
export async function approveScheduled(client, scheduleId, sellerKey) {
  const tx = await (
    await new ScheduleSignTransaction()
      .setScheduleId(scheduleId)
      .freezeWith(client)
      .sign(sellerKey instanceof PrivateKey ? sellerKey : PrivateKey.fromStringECDSA(sellerKey))
  ).execute(client);
  const receipt = await tx.getReceipt(client);
  return { txId: tx.transactionId.toString(), status: receipt.status.toString() };
}

export async function scheduleStatus(client, scheduleId) {
  const info = await new ScheduleInfoQuery().setScheduleId(scheduleId).execute(client);
  return {
    scheduleId,
    executed: info.executed != null,
    executedAt: info.executed?.toDate?.()?.toISOString() ?? null,
    memo: info.scheduleMemo,
  };
}
