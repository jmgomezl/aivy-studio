// Real buyer-funded settlement in KUSD — the leg that makes the negotiated price
// actually move (not the symbolic capped-HBAR scheduled tx). On an accepted deal
// the agent transfers the negotiated amount in KUSD from the BUYER's funded
// managed wallet → the SELLER's funded wallet, signed by the buyer's own key.
//
// Custody: both are managed-custody wallets (the platform holds the encrypted
// key in the keyvault and signs on the user's behalf — the same model as the
// rest of Kickoff). The funds and the movement are real on-chain; we label it
// "buyer-funded" because the money leaves the buyer's balance, not the operator's.
// Best-effort + async, like the Uniswap/insurance legs — never blocks the deal.
import { readFileSync } from 'node:fs';
import { Client, PrivateKey, TransferTransaction, AccountId } from '@hashgraph/sdk';
import { decryptSecret } from '../backend/lib/keyvault.js';
import { publishMessage } from './hedera.js';

const DECIMALS = Number(process.env.KUSD_DECIMALS || 6);
const SELLERS_FILE = 'data/sellers.json';

export function kusdPaymentEnabled() {
  return !!process.env.KUSD_TOKEN_ID;
}

function loadSellers() {
  try {
    return JSON.parse(readFileSync(SELLERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Find a funded managed wallet by its EVM address (case-insensitive). */
function findFundedByEvm(sellers, evm) {
  if (!evm) return null;
  const want = String(evm).toLowerCase();
  for (const rec of Object.values(sellers)) {
    if (rec?.evmAddress?.toLowerCase() === want && rec.funded && rec.hederaAccount && rec.encryptedKey) {
      return rec;
    }
  }
  return null;
}

const toUnits = (usd) => Math.round(usd * 10 ** DECIMALS);

/**
 * Settle the real negotiated amount in KUSD, buyer → seller.
 * Skips quietly (logs why) unless BOTH sides are funded managed wallets.
 */
export async function payRealKusd(client, topic, { negotiationId, buyerAddress, sellerWalletEvm, amountUsd }) {
  if (!kusdPaymentEnabled()) return;
  try {
    const tokenId = process.env.KUSD_TOKEN_ID;
    const sellers = loadSellers();
    const buyer = findFundedByEvm(sellers, buyerAddress);
    const seller = findFundedByEvm(sellers, sellerWalletEvm);
    if (!buyer) { console.log(`[kusd] skip #${negotiationId}: buyer wallet not funded/managed`); return; }
    if (!seller) { console.log(`[kusd] skip #${negotiationId}: seller wallet not funded/managed`); return; }

    // Read the buyer's live KUSD balance; never overdraw — pay min(price, balance).
    const bal = await readKusdBalance(buyer.hederaAccount, tokenId);
    const requested = Math.max(0, Math.round(Number(amountUsd) || 0));
    const amount = Math.min(requested, Math.floor(bal));
    if (amount <= 0) { console.log(`[kusd] skip #${negotiationId}: nothing to pay (balance ${bal})`); return; }

    const buyerKey = PrivateKey.fromStringECDSA(await decryptSecret(buyer.encryptedKey));
    const buyerClient = Client.forTestnet().setOperator(buyer.hederaAccount, buyerKey);
    const units = toUnits(amount);
    const tx = await new TransferTransaction()
      .addTokenTransfer(tokenId, AccountId.fromString(buyer.hederaAccount), -units)
      .addTokenTransfer(tokenId, AccountId.fromString(seller.hederaAccount), units)
      .setTransactionMemo(`kickoff:pay:${negotiationId}`)
      .execute(buyerClient);
    await tx.getReceipt(buyerClient);
    buyerClient.close();

    await publishMessage(client, topic, {
      type: 'payment',
      negotiationId,
      token: 'KUSD',
      tokenId,
      amountUsd: amount,
      requestedUsd: requested,
      capped: amount < requested,
      from: buyer.hederaAccount,
      to: seller.hederaAccount,
      custody: 'buyer-funded',
      txId: tx.transactionId.toString(),
    });
    console.log(`[kusd] paid ${amount} KUSD #${negotiationId} · ${buyer.hederaAccount} → ${seller.hederaAccount} · tx ${tx.transactionId}`);
  } catch (err) {
    console.warn(`[kusd] payment failed (deal stands):`, err.message);
  }
}

async function readKusdBalance(accountId, tokenId) {
  const MIRROR = process.env.MIRROR_NODE_URL || 'https://testnet.mirrornode.hedera.com';
  try {
    const res = await fetch(`${MIRROR}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`);
    const data = await res.json();
    const t = (data.tokens || []).find((x) => x.token_id === tokenId);
    return t ? t.balance / 10 ** DECIMALS : 0;
  } catch {
    return 0;
  }
}
