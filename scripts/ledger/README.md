# Ledger validation — run this BEFORE we build the gate

Two spikes that confirm the $10k Ledger path is real. Do **Spike 1 first** — if it
passes, the Ledger bounty is winnable and Spike 2 is optional.

## Spike 1 — EVM Clear-Sign (mature, Uniswap-compatible) ✅ priority

```bash
npm i -D @ledgerhq/hw-transport-node-hid @ledgerhq/hw-app-eth
# Plug in Ledger, unlock, open the **Ethereum** app
node scripts/ledger/spike-evm.js
# Confirm the tx ON THE DEVICE when prompted
```

**Pass =** prints `🟢 SPIKE 1 PASSED`. That means the device Clear-Signs EVM
transactions our app builds — which is exactly the hybrid-mode approval gate and
the Uniswap settlement signature.

Optional real broadcast (needs testnet ETH on the printed address):
```bash
BROADCAST=1 EVM_RPC=https://sepolia.unichain.org node scripts/ledger/spike-evm.js
```

## Spike 2 — Hedera-native (harder, optional)

```bash
# Install the Hedera app via Ledger Live, then:
node scripts/ledger/spike-hedera.js
```
Scaffold only — finish only if you specifically need Hedera-native device
signing. The EVM path alone satisfies the bounty.

## Decision rule

- Spike 1 passes → **build the Ledger gate on the EVM Clear-Sign path.** Tell me and I'll wire it into the hybrid-mode settlement + the 3-mode picker.
- Spike 1 fails → send me the error; we debug transport/app/derivation-path before building anything.
