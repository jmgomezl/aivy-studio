// Optional package insurance leg — when a buyer opted in, the agent buys a policy
// on the KickoffInsurance contract (Hedera EVM) as the deal closes: a real on-chain
// premium funds the pool, and the policy is recorded back on HCS-10. Best-effort
// and async, like the Uniswap leg — never blocks settlement.
import { ethers } from 'ethers';
import { publishMessage } from './hedera.js';

const RPC = process.env.HEDERA_JSON_RPC_URL || 'https://testnet.hashio.io/api';
const CONTRACT = process.env.INSURANCE_CONTRACT_ADDRESS;
const PREMIUM_HBAR = Number(process.env.INSURANCE_PREMIUM_HBAR || 1);
const ABI = ['function insure(bytes32 dealId, address beneficiary, uint256 coverageHbar) payable'];

export function insuranceEnabled() {
  return !!CONTRACT && !!process.env.EVM_OPERATOR_PRIVATE_KEY;
}

export async function insureDeal(client, topic, { negotiationId, coverageHbar = 1 }) {
  if (!insuranceEnabled()) return;
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(process.env.EVM_OPERATOR_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT, ABI, wallet);
    const dealId = ethers.id(String(negotiationId)); // bytes32
    const fee = await provider.getFeeData();
    const gasPrice = fee.gasPrice ? (fee.gasPrice * 13n) / 10n : ethers.parseUnits('600', 'gwei');
    const tx = await contract.insure(dealId, wallet.address, Math.max(1, Math.round(coverageHbar)), {
      value: ethers.parseEther(String(PREMIUM_HBAR)), // premium in HBAR
      gasLimit: 300000,
      gasPrice,
    });
    await tx.wait();
    await publishMessage(client, topic, {
      type: 'insurance',
      negotiationId,
      status: 'active',
      premiumHbar: PREMIUM_HBAR,
      coverageHbar: Math.max(1, Math.round(coverageHbar)),
      contract: CONTRACT,
      txHash: tx.hash,
    });
    console.log(`[insurance] policy bought #${negotiationId} — ${PREMIUM_HBAR} HBAR premium — tx ${tx.hash}`);
  } catch (err) {
    console.warn('[insurance] policy purchase failed (deal stands):', err.message);
  }
}
