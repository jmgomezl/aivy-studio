// Ledger HITL helpers — lazy-create + fund the Ledger's Hedera account so the
// human can Clear-Sign and broadcast a high-value settlement from it.
//
// The Ledger's private key lives on the device, so we can't AccountCreate with
// its key. Instead we transfer HBAR to its EVM-address ALIAS via the Hedera SDK,
// which AUTO-CREATES a hollow account for that address (a plain EVM value
// transfer with low gas reverts — Hedera account creation needs the alias path).
// The Ledger's first signed tx then finalizes the account.
import { Client, PrivateKey, TransferTransaction, Hbar, AccountId } from '@hashgraph/sdk';

const MIRROR = process.env.MIRROR_NODE_URL || 'https://testnet.mirrornode.hedera.com';
const GAS_TOPUP_HBAR = Number(process.env.LEDGER_GAS_TOPUP_HBAR || 2);
const MIN_HBAR = 0.5;

export function ledgerFundingEnabled() {
  return !!(process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY);
}

async function mirrorBalanceHbar(address) {
  try {
    const res = await fetch(`${MIRROR}/api/v1/accounts/${address}`);
    if (!res.ok) return null; // 404 → no account yet
    const a = await res.json();
    return (a.balance?.balance ?? 0) / 1e8;
  } catch {
    return null;
  }
}

/** Lazy-create (if needed) + top up the Ledger address with Hedera-EVM gas. */
export async function fundForGas(address) {
  if (!ledgerFundingEnabled()) return { funded: false, reason: 'no operator credentials' };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) return { funded: false, reason: 'bad address' };

  const existing = await mirrorBalanceHbar(address);
  if (existing != null && existing >= MIN_HBAR) {
    return { funded: false, already: true, hbar: existing };
  }

  const client = Client.forTestnet().setOperator(
    process.env.HEDERA_OPERATOR_ID,
    PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY)
  );
  try {
    // Transfer to the EVM-address alias → Hedera auto-creates the account.
    const alias = AccountId.fromEvmAddress(0, 0, address);
    const tx = await new TransferTransaction()
      .addHbarTransfer(process.env.HEDERA_OPERATOR_ID, new Hbar(-GAS_TOPUP_HBAR))
      .addHbarTransfer(alias, new Hbar(GAS_TOPUP_HBAR))
      .setTransactionMemo('kickoff:ledger:gas')
      .execute(client);
    const receipt = await tx.getReceipt(client);
    return { funded: true, hbar: GAS_TOPUP_HBAR, status: receipt.status.toString(), txId: tx.transactionId.toString() };
  } finally {
    client.close();
  }
}
