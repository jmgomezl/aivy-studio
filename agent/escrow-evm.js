// Optional buyer-funded escrow leg — when a buyer opts in, the offer amount is
// LOCKED on the KickoffEscrow contract (Hedera EVM) before the seller agent
// decides. On accept it's RELEASED to the seller; on reject it's REFUNDED to the
// buyer. Each leg is a real on-chain tx recorded back on HCS-10 as an `escrow`
// event. Mirrors the insurance leg, but escrow gates the deal: the lock is
// awaited (so "locked" lands before the verdict), release/refund are best-effort.
//
// Custody honesty: the buyer's managed wallet is identity-only today, so the
// OPERATOR funds the lock on the buyer's behalf, capped at DEMO_SETTLE_HBAR. The
// custody boundary (funds in the contract) and the release/refund legs are real;
// we label the funding as operator-funded everywhere it surfaces.
import { ethers } from 'ethers';
import { publishMessage } from './hedera.js';

const RPC = process.env.HEDERA_JSON_RPC_URL || 'https://testnet.hashio.io/api';
const CONTRACT = process.env.ESCROW_CONTRACT_ADDRESS;
const CAP_HBAR = Number(process.env.DEMO_SETTLE_HBAR || 1);
const ABI = [
  'function lock(bytes32 dealId, address buyer, address seller) payable',
  'function release(bytes32 dealId)',
  'function refund(bytes32 dealId)',
];

export function escrowEnabled() {
  return !!CONTRACT && !!process.env.EVM_OPERATOR_PRIVATE_KEY;
}

function operatorWallet() {
  const provider = new ethers.JsonRpcProvider(RPC);
  return new ethers.Wallet(process.env.EVM_OPERATOR_PRIVATE_KEY, provider);
}

async function gasPrice(provider) {
  const fee = await provider.getFeeData();
  return fee.gasPrice ? (fee.gasPrice * 13n) / 10n : ethers.parseUnits('600', 'gwei');
}

/** Lock the (capped) offer amount in escrow. Awaited — gates the deal narrative. */
export async function lockEscrowEvm(client, topic, { negotiationId, buyerAddress, amountHbar }) {
  if (!escrowEnabled()) return null;
  try {
    const wallet = operatorWallet();
    const seller = wallet.address; // operator is the seller-side custodian (matches settleDeal)
    const buyer = buyerAddress && ethers.isAddress(buyerAddress) ? buyerAddress : wallet.address;
    const amount = Math.min(Number(amountHbar) || CAP_HBAR, CAP_HBAR);
    const contract = new ethers.Contract(CONTRACT, ABI, wallet);
    const dealId = ethers.id(String(negotiationId));
    const tx = await contract.lock(dealId, buyer, seller, {
      value: ethers.parseEther(String(amount)),
      gasLimit: 250000,
      gasPrice: await gasPrice(wallet.provider),
    });
    await tx.wait();
    await publishMessage(client, topic, {
      type: 'escrow',
      negotiationId,
      status: 'locked',
      amountHbar: amount,
      buyer,
      seller,
      custody: 'operator-funded',
      contract: CONTRACT,
      txHash: tx.hash,
    });
    console.log(`[escrow] locked ${amount} HBAR #${negotiationId} (operator-funded) — tx ${tx.hash}`);
    return { dealId, amount, buyer, seller };
  } catch (err) {
    console.warn('[escrow] lock failed (deal stands, no escrow):', err.message);
    return null;
  }
}

async function settleEscrow(client, topic, fn, statusLabel, { negotiationId, amountHbar }) {
  if (!escrowEnabled()) return;
  try {
    const wallet = operatorWallet();
    const contract = new ethers.Contract(CONTRACT, ABI, wallet);
    const dealId = ethers.id(String(negotiationId));
    const tx = await contract[fn](dealId, { gasLimit: 200000, gasPrice: await gasPrice(wallet.provider) });
    await tx.wait();
    await publishMessage(client, topic, {
      type: 'escrow',
      negotiationId,
      status: statusLabel,
      amountHbar,
      custody: 'operator-funded',
      contract: CONTRACT,
      txHash: tx.hash,
    });
    console.log(`[escrow] ${statusLabel} ${amountHbar} HBAR #${negotiationId} — tx ${tx.hash}`);
  } catch (err) {
    console.warn(`[escrow] ${statusLabel} failed:`, err.message);
  }
}

/** Deal accepted — release escrow to the seller. */
export function releaseEscrowEvm(client, topic, args) {
  return settleEscrow(client, topic, 'release', 'released', args);
}

/** Deal rejected — refund escrow to the buyer. */
export function refundEscrowEvm(client, topic, args) {
  return settleEscrow(client, topic, 'refund', 'refunded', args);
}
