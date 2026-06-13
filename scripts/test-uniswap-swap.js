// One-command Uniswap validation. Run once you have:
//   UNISWAP_API_KEY set, EVM agent address funded on the target chain.
//
//   node scripts/test-uniswap-swap.js
//   (override: TOKEN_IN, TOKEN_OUT, AMOUNT_IN, EVM_CHAIN_ID via env)
//
// Executes a real swap through the hak-uniswap-plugin and prints the tx hash.
import 'dotenv/config';
import { uniswapPlugin } from '../plugins/hak-uniswap-plugin/src/index.js';

const swap = uniswapPlugin.tools({}).find((t) => t.method === 'uniswap_swap');

const params = {
  tokenIn: process.env.TOKEN_IN || 'native',
  tokenOut: process.env.TOKEN_OUT, // set to a token with testnet liquidity
  amountIn: process.env.AMOUNT_IN || '1000000000000000', // 0.001 ETH
  chainId: Number(process.env.EVM_CHAIN_ID || 1301),
  slippageBps: Number(process.env.SLIPPAGE_BPS || 100),
};

if (!process.env.UNISWAP_API_KEY) {
  console.error('Set UNISWAP_API_KEY first.');
  process.exit(1);
}
if (!params.tokenOut) {
  console.error('Set TOKEN_OUT to a token address with liquidity on the target chain.');
  process.exit(1);
}

console.log('Swapping', params.amountIn, params.tokenIn, '→', params.tokenOut, 'on chain', params.chainId, '…');
const result = await swap.execute(null, {}, params);
console.log(JSON.stringify(result, null, 2));
if (result.status === 'executed') {
  console.log('\n🟢 UNISWAP SWAP EXECUTED —', result.txHash);
}
