// Ledger HITL helpers — top up a Ledger-controlled address with a little Hedera
// EVM gas so the human can Clear-Sign and broadcast the high-value settlement.
// Operator-funded + capped; only tops up when the balance is low.
import { ethers } from 'ethers';

const RPC = process.env.HEDERA_JSON_RPC_URL || 'https://testnet.hashio.io/api';
const GAS_TOPUP_HBAR = Number(process.env.LEDGER_GAS_TOPUP_HBAR || 1);
const MIN_HBAR = 0.2;

export function ledgerFundingEnabled() {
  return !!process.env.EVM_OPERATOR_PRIVATE_KEY;
}

/** Send a small amount of Hedera-EVM gas to a Ledger address if it's low. */
export async function fundForGas(address) {
  if (!ledgerFundingEnabled()) return { funded: false, reason: 'no operator key' };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) return { funded: false, reason: 'bad address' };
  const provider = new ethers.JsonRpcProvider(RPC);
  const bal = await provider.getBalance(address);
  if (bal >= ethers.parseEther(String(MIN_HBAR))) {
    return { funded: false, already: true, hbar: Number(ethers.formatEther(bal)) };
  }
  const wallet = new ethers.Wallet(process.env.EVM_OPERATOR_PRIVATE_KEY, provider);
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice ? (fee.gasPrice * 12n) / 10n : ethers.parseUnits('600', 'gwei');
  const tx = await wallet.sendTransaction({ to: address, value: ethers.parseEther(String(GAS_TOPUP_HBAR)), gasLimit: 30000, gasPrice });
  await tx.wait();
  return { funded: true, hbar: GAS_TOPUP_HBAR, txHash: tx.hash };
}
