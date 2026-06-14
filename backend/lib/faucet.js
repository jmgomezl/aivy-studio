// KUSD faucet — provision a managed wallet's real Hedera account and fund it so
// judges can test the platform with real balances (no testnet-HBAR drain, real
// settlement). Two on-chain steps, operator-paid:
//   1. AccountCreate bound to the wallet's EVM alias (one identity across both
//      chains), with unlimited auto-token-associations and a little gas HBAR so
//      the account can later sign its own transfers (Phase B buyer-funded pay).
//   2. Transfer the KUSD grant from the operator treasury → the new account
//      (auto-associates via the open slots).
// Best-effort and idempotent at the caller: only the first wallet creation funds.
import {
  PrivateKey,
  AccountCreateTransaction,
  TransferTransaction,
  Hbar,
  AccountId,
} from '@hashgraph/sdk';
import { decryptSecret } from './keyvault.js';

const DECIMALS = Number(process.env.KUSD_DECIMALS || 6);
const GRANT_USD = Number(process.env.FAUCET_KUSD_AMOUNT || 1000);
const GAS_HBAR = Number(process.env.FAUCET_GAS_HBAR || 1);

export function faucetEnabled() {
  return !!process.env.KUSD_TOKEN_ID;
}

const toUnits = (usd) => Math.round(usd * 10 ** DECIMALS);

/**
 * Provision + fund a managed wallet. Returns the funding receipt, or throws.
 * @param {object} record  managed-wallet record (has encryptedKey + evmAddress)
 * @param {Client} operatorClient  Hedera client operated by the treasury/operator
 */
export async function provisionAndFund(record, operatorClient) {
  if (!faucetEnabled()) throw new Error('faucet disabled (KUSD_TOKEN_ID unset)');
  const tokenId = process.env.KUSD_TOKEN_ID;
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const walletKey = PrivateKey.fromStringECDSA(await decryptSecret(record.encryptedKey));

  // 1. Create the real account, bound to the wallet's EVM alias, with unlimited
  //    auto-associations + gas. Operator pays; the wallet key co-signs to prove
  //    ownership of the alias.
  const createTx = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(walletKey)
    .setInitialBalance(new Hbar(GAS_HBAR))
    .setMaxAutomaticTokenAssociations(-1)
    .setTransactionMemo(`kickoff:faucet:provision:${record.evmAddress}`)
    .freezeWith(operatorClient)
    .sign(walletKey);
  const createResp = await createTx.execute(operatorClient);
  const accountId = (await createResp.getReceipt(operatorClient)).accountId.toString();

  // 2. Grant the KUSD from the operator treasury → the new account.
  const grantUnits = toUnits(GRANT_USD);
  const grantTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, operatorId, -grantUnits)
    .addTokenTransfer(tokenId, AccountId.fromString(accountId), grantUnits)
    .setTransactionMemo(`kickoff:faucet:grant:${accountId}`)
    .execute(operatorClient);
  await grantTx.getReceipt(operatorClient);

  return {
    accountId,
    fundedUsd: GRANT_USD,
    gasHbar: GAS_HBAR,
    tokenId,
    createTx: createResp.transactionId.toString(),
    grantTx: grantTx.transactionId.toString(),
  };
}

/** Read live balances (KUSD + HBAR) for an account from the mirror node. */
export async function readBalances(accountIdOrEvm) {
  const MIRROR = process.env.MIRROR_NODE_URL || 'https://testnet.mirrornode.hedera.com';
  const tokenId = process.env.KUSD_TOKEN_ID;
  try {
    const res = await fetch(`${MIRROR}/api/v1/accounts/${accountIdOrEvm}`);
    if (!res.ok) return null;
    const a = await res.json();
    const hbar = (a.balance?.balance ?? 0) / 1e8;
    const tok = (a.balance?.tokens || []).find((t) => t.token_id === tokenId);
    const usd = tok ? tok.balance / 10 ** DECIMALS : 0;
    return { accountId: a.account, hbar, usd, tokenId };
  } catch {
    return null;
  }
}
