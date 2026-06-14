// Ledger Device Management Kit (DMK) over WebHID — the human-in-the-loop signer.
// A high-value agent settlement is Clear-Signed on the user's physical Ledger
// before it can execute: the device is the final confirmation gate. DMK is
// lazy-imported so its heavy bundle only loads on the Ledger flow, and WebHID
// (Chromium + HTTPS/localhost + a user gesture) is honored by design.
//
// Flow: connect (WebHID picker) → derive+verify ETH address → Clear-Sign an
// EIP-155 tx → broadcast to Hedera EVM. r/s/v come from the device; the unsigned
// tx never leaves our code unsigned-broadcast.
import { Transaction, getBytes, Signature, JsonRpcProvider } from 'ethers';

const DERIVATION = "44'/60'/0'/0/0";
const ORIGIN_TOKEN = import.meta.env.VITE_LEDGER_ORIGIN_TOKEN || undefined; // enables contract Clear Signing

// Subscribe to a DMK device-action observable and translate it into HITL prompts.
function runAction({ observable }, onPrompt) {
  return new Promise(async (resolve, reject) => {
    const { DeviceActionStatus, UserInteractionRequired } = await import('@ledgerhq/device-management-kit');
    const sub = observable.subscribe({
      next: (state) => {
        if (state.status === DeviceActionStatus.Pending) {
          const need = state.intermediateValue?.requiredUserInteraction;
          const map = {
            [UserInteractionRequired.UnlockDevice]: 'Unlock your Ledger (enter PIN).',
            [UserInteractionRequired.ConfirmOpenApp]: 'Confirm opening the Ethereum app on your Ledger.',
            [UserInteractionRequired.VerifyAddress]: 'Verify the address shown on your Ledger.',
            [UserInteractionRequired.SignTransaction]: 'Review & approve the settlement on your Ledger.',
            [UserInteractionRequired.AllowSecureConnection]: 'Allow the secure connection on your Ledger.',
          };
          if (map[need]) onPrompt?.(map[need]);
        } else if (state.status === DeviceActionStatus.Completed) {
          sub.unsubscribe();
          resolve(state.output);
        } else if (state.status === DeviceActionStatus.Error) {
          sub.unsubscribe();
          reject(state.error || new Error('device action failed'));
        } else if (state.status === DeviceActionStatus.Stopped) {
          sub.unsubscribe();
          reject(new Error('cancelled on device'));
        }
      },
      error: reject,
    });
  });
}

/** Connect to a Ledger over WebHID (must be called from a user gesture). */
export async function connectLedger(onPrompt) {
  const { DeviceManagementKitBuilder } = await import('@ledgerhq/device-management-kit');
  const { webHidTransportFactory } = await import('@ledgerhq/device-transport-kit-web-hid');
  const { firstValueFrom } = await import('rxjs');
  const dmk = new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build();
  onPrompt?.('Select your Ledger in the browser prompt…');
  const device = await firstValueFrom(dmk.startDiscovering({ transport: 'WEB-HID' }));
  const sessionId = await dmk.connect({ device });
  return { dmk, sessionId };
}

/** Derive + verify the Ledger's Ethereum address on the device screen. */
export async function getLedgerAddress({ dmk, sessionId }, { verify = false, onPrompt } = {}) {
  const { SignerEthBuilder } = await import('@ledgerhq/device-signer-kit-ethereum');
  const signer = new SignerEthBuilder({ dmk, sessionId, originToken: ORIGIN_TOKEN }).build();
  const out = await runAction(signer.getAddress(DERIVATION, { checkOnDevice: verify }), onPrompt);
  return out.address;
}

/**
 * Clear-Sign a high-value settlement tx on the Ledger and broadcast it.
 * @returns {Promise<{hash, from, to, value, chainId, explorer}>}
 */
export async function clearSignAndBroadcast({ dmk, sessionId }, { to, valueWei, chainId, rpcUrl, explorerTx }, onPrompt) {
  const { SignerEthBuilder } = await import('@ledgerhq/device-signer-kit-ethereum');
  const provider = new JsonRpcProvider(rpcUrl);
  const signer = new SignerEthBuilder({ dmk, sessionId, originToken: ORIGIN_TOKEN }).build();
  const from = await getLedgerAddress({ dmk, sessionId }, { onPrompt });

  const nonce = await provider.getTransactionCount(from);
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice ? (fee.gasPrice * 12n) / 10n : 600000000000n;
  const tx = Transaction.from({ to, value: BigInt(valueWei), chainId, nonce, gasLimit: 21000n, gasPrice, type: 0, data: '0x' });

  // DMK expects the RLP-encoded UNSIGNED tx as bytes; r/s/v come back from the device.
  const out = await runAction(signer.signTransaction(DERIVATION, getBytes(tx.unsignedSerialized)), onPrompt);
  tx.signature = Signature.from({ r: out.r, s: out.s, v: Number(out.v) });
  const sent = await provider.broadcastTransaction(tx.serialized);
  return { hash: sent.hash, from, to, value: tx.value.toString(), chainId, explorer: explorerTx(sent.hash) };
}
