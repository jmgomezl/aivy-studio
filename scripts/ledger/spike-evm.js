// LEDGER VALIDATION — SPIKE 1 (EVM, the mature + Uniswap-compatible path)
//
// Proves your Ledger can Clear-Sign an EVM transaction that our app builds.
// This is the gate for the $10k Ledger bounty and the hybrid-mode approval.
//
// PREP (once):
//   npm i -D @ledgerhq/hw-transport-node-hid @ledgerhq/hw-app-eth @ledgerhq/hw-app-eth/lib/services/ledger
//   (if the last path errors, just: npm i -D @ledgerhq/hw-transport-node-hid @ledgerhq/hw-app-eth)
// RUN:
//   1. Plug in the Ledger, unlock it, open the **Ethereum** app
//   2. node scripts/ledger/spike-evm.js
//   3. Confirm the transaction ON THE DEVICE when prompted
//
// Optional broadcast (needs testnet ETH on the address it prints):
//   BROADCAST=1 EVM_RPC=https://sepolia.unichain.org node scripts/ledger/spike-evm.js
import { ethers } from 'ethers';

const PATH = process.env.LEDGER_PATH || "44'/60'/0'/0/0"; // Ledger Live ETH account 0
const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || 1301); // Unichain Sepolia

async function main() {
  let Transport, Eth, ledgerService;
  try {
    Transport = (await import('@ledgerhq/hw-transport-node-hid')).default;
    Eth = (await import('@ledgerhq/hw-app-eth')).default;
    ledgerService = (await import('@ledgerhq/hw-app-eth')).ledgerService;
  } catch {
    console.error('Missing libs. Run:\n  npm i -D @ledgerhq/hw-transport-node-hid @ledgerhq/hw-app-eth');
    process.exit(1);
  }

  console.log('Connecting to Ledger (unlock + open the Ethereum app)…');
  const transport = await Transport.create();
  const eth = new Eth(transport);

  const { address } = await eth.getAddress(PATH);
  console.log('✅ Device address:', address);

  // Build a minimal EIP-1559 self-transfer to sign
  const tx = ethers.Transaction.from({
    to: address,
    value: 0n,
    chainId: CHAIN_ID,
    nonce: Number(process.env.NONCE || 0),
    maxFeePerGas: ethers.parseUnits('2', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
    gasLimit: 21000n,
    type: 2,
  });

  const unsigned = tx.unsignedSerialized.slice(2);
  const resolution = await ledgerService.resolveTransaction(unsigned, {}, {});
  console.log('\n👉 Confirm the transaction ON THE DEVICE (this is the Clear-Signing moment)…');
  const sig = await eth.signTransaction(PATH, unsigned, resolution);

  tx.signature = ethers.Signature.from({
    r: '0x' + sig.r,
    s: '0x' + sig.s,
    v: parseInt(sig.v, 16),
  });
  const recovered = ethers.recoverAddress(tx.unsignedHash, tx.signature);
  const ok = recovered.toLowerCase() === address.toLowerCase();
  console.log('\n✅ Signed. Recovered signer matches device:', ok);
  if (!ok) throw new Error('signature mismatch — investigate before building the gate');

  if (process.env.BROADCAST === '1' && process.env.EVM_RPC) {
    const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC);
    const sent = await provider.broadcastTransaction(tx.serialized);
    console.log('📡 Broadcast tx:', sent.hash);
  } else {
    console.log('(skipped broadcast — set BROADCAST=1 EVM_RPC=… with funds to send a real tx)');
  }

  await transport.close();
  console.log('\n🟢 SPIKE 1 PASSED — the Ledger Clear-Signs EVM txs our app builds. The Ledger bounty is in reach.');
}

main().catch((e) => {
  console.error('❌ spike failed:', e.message);
  process.exit(1);
});
