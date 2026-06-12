// HTS escrow flow — native HBAR, no EVM involved.
// lock:    buyer -> escrow account (operator treasury) when an offer is made
// release: escrow -> seller agent when the deal is accepted
// refund:  escrow -> buyer when the deal is rejected
// All transfers carry a memo with the negotiationId so the audit trail on the
// mirror node lines up with the HCS-10 transcript (lesson D: results bind to
// the exact deal).
import {
  Client,
  PrivateKey,
  TransferTransaction,
  Hbar,
} from '@hashgraph/sdk';

export function escrowClient() {
  const client = Client.forTestnet();
  client.setOperator(
    process.env.HEDERA_OPERATOR_ID,
    PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY)
  );
  return client;
}

const ESCROW = () => process.env.HEDERA_OPERATOR_ID;

async function transfer(client, from, to, amountHbar, memo) {
  const tx = await new TransferTransaction()
    .addHbarTransfer(from, new Hbar(-amountHbar))
    .addHbarTransfer(to, new Hbar(amountHbar))
    .setTransactionMemo(memo)
    .execute(client);
  const receipt = await tx.getReceipt(client);
  return { txId: tx.transactionId.toString(), status: receipt.status.toString() };
}

/** Lock the buyer's offer amount into escrow. Client must be operated by the buyer. */
export function lockEscrow(buyerClient, buyerAccountId, amountHbar, negotiationId) {
  return transfer(
    buyerClient,
    buyerAccountId,
    ESCROW(),
    amountHbar,
    `kickoff:lock:${negotiationId}`
  );
}

/** Release escrowed funds to the seller on an accepted deal. */
export function releaseEscrow(client, sellerAccountId, amountHbar, negotiationId) {
  return transfer(
    client,
    ESCROW(),
    sellerAccountId,
    amountHbar,
    `kickoff:release:${negotiationId}`
  );
}

/** Refund the buyer on a rejected deal. */
export function refundEscrow(client, buyerAccountId, amountHbar, negotiationId) {
  return transfer(
    client,
    ESCROW(),
    buyerAccountId,
    amountHbar,
    `kickoff:refund:${negotiationId}`
  );
}
