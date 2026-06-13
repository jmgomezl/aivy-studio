// hak-uniswap-plugin — the first Uniswap plugin for the Hedera Agent Kit.
//
// Gives a HAK agent the ability to swap tokens through Uniswap's permissionless
// liquidity on an EVM chain (Unichain/Base/etc.) via the Uniswap Trading API.
// A Hedera-native agent can now accept any token and rebalance/settle across
// assets autonomously — financial freedom for agents. High-value swaps can be
// gated by a Ledger Clear-Sign (see KICKOFF_LEDGER_THRESHOLD).
//
// Plugin shape matches hedera-agent-kit@3.x:
//   Plugin { name, version, description, tools: (context) => Tool[] }
//   Tool   { method, name, description, parameters: ZodObject, execute(client, context, params) }
import { z } from 'zod';
import { ethers } from 'ethers';

const TRADE_API = process.env.UNISWAP_TRADE_API || 'https://trade-api.gateway.uniswap.org/v1';

// Minimal chain registry — extend as needed.
const CHAINS = {
  1301: { name: 'unichain-sepolia', rpc: 'https://sepolia.unichain.org' },
  84532: { name: 'base-sepolia', rpc: 'https://sepolia.base.org' },
  130: { name: 'unichain', rpc: 'https://mainnet.unichain.org' },
  8453: { name: 'base', rpc: 'https://mainnet.base.org' },
};

function signer(chainId) {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`unsupported chainId ${chainId}`);
  const pk = process.env.EVM_AGENT_PRIVATE_KEY || process.env.EVM_OPERATOR_PRIVATE_KEY;
  if (!pk) throw new Error('no EVM key (EVM_AGENT_PRIVATE_KEY)');
  const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC || chain.rpc);
  return new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk, provider);
}

async function uniswap(path, body) {
  const res = await fetch(`${TRADE_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.UNISWAP_API_KEY || '' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Uniswap API ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

const swapTool = (context) => ({
  method: 'uniswap_swap',
  name: 'Uniswap Swap',
  description:
    'Swap one token for another through Uniswap permissionless liquidity on an EVM chain. ' +
    'Use to accept any token, rebalance an agent treasury, or settle a deal cross-asset.',
  parameters: z.object({
    tokenIn: z.string().describe('input token address (or "native")'),
    tokenOut: z.string().describe('output token address (or "native")'),
    amountIn: z.string().describe('input amount in smallest units (wei)'),
    chainId: z.number().default(Number(process.env.EVM_CHAIN_ID || 1301)),
    slippageBps: z.number().default(50).describe('max slippage in basis points'),
  }),
  async execute(_client, _ctx, params) {
    const { tokenIn, tokenOut, amountIn, chainId, slippageBps } = params;
    const wallet = signer(chainId);

    // 1. Quote
    const quote = await uniswap('/quote', {
      type: 'EXACT_INPUT',
      tokenInChainId: chainId,
      tokenOutChainId: chainId,
      tokenIn,
      tokenOut,
      amount: amountIn,
      swapper: wallet.address,
      slippageTolerance: slippageBps / 100,
    });

    // 2. Approval (ERC-20 in)
    if (tokenIn !== 'native') {
      const approval = await uniswap('/check_approval', {
        token: tokenIn,
        amount: amountIn,
        walletAddress: wallet.address,
        chainId,
      });
      if (approval?.approval) {
        const txa = await wallet.sendTransaction(approval.approval);
        await txa.wait();
      }
    }

    // 3. Threshold gate — above the limit, return calldata for Ledger Clear-Sign.
    const threshold = process.env.KICKOFF_LEDGER_THRESHOLD;
    if (threshold && BigInt(amountIn) > BigInt(threshold)) {
      const swap = await uniswap('/swap', { quote: quote.quote });
      return {
        status: 'requires_ledger_approval',
        reason: `amount exceeds Ledger threshold (${threshold})`,
        chainId,
        unsignedTx: swap.swap, // hand to the Ledger Clear-Sign gate
        quote: quote.quote,
      };
    }

    // 4. Execute
    const swap = await uniswap('/swap', { quote: quote.quote });
    const tx = await wallet.sendTransaction(swap.swap);
    const receipt = await tx.wait();
    return {
      status: 'executed',
      txHash: tx.hash,
      chainId,
      explorer: `${CHAINS[chainId].name}:${tx.hash}`,
      amountIn,
      route: quote.quote?.route ?? null,
      blockNumber: receipt.blockNumber,
    };
  },
});

export const uniswapPlugin = {
  name: 'hak-uniswap-plugin',
  version: '0.1.0',
  description:
    'Swap tokens through Uniswap permissionless liquidity from a Hedera Agent Kit agent. ' +
    'Cross-asset settlement and treasury rebalancing on EVM chains, optionally Ledger-gated.',
  tools: (context) => [swapTool(context)],
};

export default uniswapPlugin;
