// Cross-asset settlement leg — wires the hak-uniswap-plugin into the live close.
// When a deal is accepted, the seller agent converts a slice of the proceeds into
// the seller's preferred token (e.g. USDC) through Uniswap's permissionless
// liquidity on an EVM chain, then publishes the swap as a settlement leg on the
// HCS-10 topic. This is the genuine "a Hedera agent settles cross-asset" story:
// the EVM swap (with its dynamic ERC-20 allowance) is recorded back on Hedera.
//
// Best-effort and gated by env — never blocks or breaks the HBAR settlement.
import { uniswapPlugin } from '../plugins/hak-uniswap-plugin/src/index.js';
import { publishMessage } from './hedera.js';

const ENABLED = process.env.UNISWAP_SETTLE_ENABLED === 'true';
const CHAIN_ID = Number(process.env.UNISWAP_SETTLE_CHAIN_ID || 11155111); // Ethereum Sepolia
const TOKEN_OUT = process.env.UNISWAP_SETTLE_TOKEN_OUT || '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'; // USDC (Sepolia)
const TOKEN_OUT_SYMBOL = process.env.UNISWAP_SETTLE_TOKEN_SYMBOL || 'USDC';
const AMOUNT_IN_WEI = process.env.UNISWAP_SETTLE_AMOUNT_WEI || '300000000000000'; // 0.0003 ETH (symbolic)

const swapTool = uniswapPlugin.tools({}).find((t) => t.method === 'uniswap_swap');

export function crossAssetSettleEnabled() {
  return ENABLED;
}

/**
 * Convert proceeds to the seller's preferred token via Uniswap and record the
 * swap on HCS-10. Fire-and-forget from the caller (the swap takes ~15-30s on an
 * EVM testnet); never throws into the negotiation loop.
 */
export async function crossAssetSettle(client, topic, { negotiationId, preferredSymbol = TOKEN_OUT_SYMBOL }) {
  if (!ENABLED) return;
  try {
    await publishMessage(client, topic, {
      type: 'swap_status',
      negotiationId,
      dex: 'uniswap',
      status: 'swapping',
      tokenOut: preferredSymbol,
    });
    const r = await swapTool.execute(null, {}, {
      tokenIn: 'native',
      tokenOut: TOKEN_OUT,
      amountIn: AMOUNT_IN_WEI,
      chainId: CHAIN_ID,
      slippageBps: 100,
    });
    await publishMessage(client, topic, {
      type: 'swap',
      negotiationId,
      dex: 'uniswap',
      chainId: CHAIN_ID,
      tokenIn: 'ETH',
      tokenOut: preferredSymbol,
      amountInWei: AMOUNT_IN_WEI,
      status: r.status,
      txHash: r.txHash ?? null,
      blockNumber: r.blockNumber ?? null,
    });
    console.log(`[uniswap] cross-asset settled #${negotiationId} — ${r.status} ${r.txHash || ''}`);
  } catch (err) {
    console.warn('[uniswap] cross-asset settle failed (HBAR settlement stands):', err.message);
    try {
      await publishMessage(client, topic, {
        type: 'swap',
        negotiationId,
        dex: 'uniswap',
        status: 'failed',
        error: String(err.message || '').slice(0, 120),
      });
    } catch {
      /* ignore */
    }
  }
}
