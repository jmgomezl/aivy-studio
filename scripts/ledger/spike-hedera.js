// LEDGER VALIDATION — SPIKE 2 (Hedera-native, the harder path)
//
// Proves your Ledger can sign a Hedera transaction directly. This is LESS
// turnkey than EVM — the Hedera Ledger app's Node integration is thinly
// documented. Run SPIKE 1 (EVM) first; if it passes, the Ledger bounty is
// already winnable via the EVM Clear-Sign path and this is a bonus.
//
// PREP:
//   - Install the **Hedera** app on the device via Ledger Live
//   - npm i -D @ledgerhq/hw-transport-node-hid
//   - The Hedera APDU app currently signs raw transaction bytes. The community
//     reference is the hedera-ledger integration; if no maintained JS lib is
//     available, the fallback is to sign the frozen transaction body bytes via
//     the app's sign APDU and attach with Transaction.addSignature().
//
// This file is a SCAFFOLD with the exact integration points marked TODO so we
// can finish it quickly IF the EVM path isn't enough. Don't block on it.
import { Client, PrivateKey, TransferTransaction, Hbar, AccountId } from '@hashgraph/sdk';

async function main() {
  console.log('Hedera Ledger spike — scaffold.');
  console.log('Priority: run spike-evm.js first. The EVM Clear-Sign path alone wins the Ledger bounty.');
  console.log('');
  console.log('If you need Hedera-native device signing, the integration points are:');
  console.log('  1. Connect via @ledgerhq/hw-transport-node-hid');
  console.log('  2. Open the Hedera app, get the public key via the app APDU');
  console.log('  3. Freeze a TransferTransaction with that key as the operator/sender');
  console.log('  4. Send the frozen body bytes to the app sign APDU → signature');
  console.log('  5. tx.addSignature(ledgerPublicKey, signatureBytes) → execute');
  console.log('');
  console.log('Decision rule: if spike-evm passed, scope the Ledger gate to EVM and skip this.');
  // TODO: implement device APDU calls once we confirm the maintained Hedera Ledger JS path.
}

main().catch((e) => { console.error(e.message); process.exit(1); });
