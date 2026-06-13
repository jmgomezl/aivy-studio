# hak-uniswap-plugin

**The first Uniswap plugin for the [Hedera Agent Kit](https://github.com/hashgraph/hedera-agent-kit).**

Gives a Hedera agent the ability to swap tokens through **Uniswap's permissionless liquidity** on an EVM chain (Unichain, Base, …) via the Uniswap Trading API. A Hedera-native agent can now **accept any token and rebalance or settle across assets autonomously** — financial freedom for agents.

Part of the [Aivy](https://aivylabs.xyz) ecosystem; ships as a drag-and-drop node in [Aivy Studio](https://studio.aivylabs.xyz).

## Why

Hedera's native DEX plugins (SaucerSwap) keep value on Hedera. This plugin extends a HAK agent **across chains** to Uniswap's liquidity — the missing piece for agents that receive arbitrary crypto and must transact freely. It's the only Uniswap plugin in the HAK ecosystem.

## Install

```bash
npm i hak-uniswap-plugin
```

## Use

```js
import { HederaLangchainToolkit } from 'hedera-agent-kit';
import { uniswapPlugin } from 'hak-uniswap-plugin';

const toolkit = new HederaLangchainToolkit({
  client,
  configuration: { plugins: [uniswapPlugin] },
});
```

## Tool: `uniswap_swap`

| param | type | notes |
|---|---|---|
| `tokenIn` | string | input token address or `"native"` |
| `tokenOut` | string | output token address or `"native"` |
| `amountIn` | string | amount in smallest units (wei) |
| `chainId` | number | default Unichain Sepolia (1301) |
| `slippageBps` | number | default 50 |

## Config

```bash
UNISWAP_API_KEY=...            # Uniswap Developer Platform
EVM_AGENT_PRIVATE_KEY=0x...    # the agent's EVM signer (secp256k1)
EVM_CHAIN_ID=1301              # Unichain Sepolia
KICKOFF_LEDGER_THRESHOLD=...   # optional — above this (wei), returns unsigned
                               # tx for a Ledger Clear-Sign instead of executing
```

## Ledger gate

When `KICKOFF_LEDGER_THRESHOLD` is set and a swap exceeds it, the tool returns
`{ status: 'requires_ledger_approval', unsignedTx }` instead of executing — hand
that to a hardware-wallet Clear-Sign flow so high-value swaps need explicit human
approval. Autonomous below the line, device-gated above it.

## Proof — real on-chain swap

Executed by a HAK agent through this plugin (native ETH → USDC, Ethereum Sepolia):

- **tx:** [`0x69babe82…2ea5fc`](https://sepolia.etherscan.io/tx/0x69babe822b2a418696c8ff2e0064a646f6c3747bc9e54659ee5beb99de2ea5fc) — status **SUCCESS**, block 11049036
- input 0.001 ETH → output ~24.37 USDC, routed by the Uniswap Trading API

Reproduce: `node scripts/test-uniswap-swap.js` (with `UNISWAP_API_KEY` + a funded signer).
