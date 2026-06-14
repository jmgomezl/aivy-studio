// Compile + deploy the ERC-8004 Identity Registry on Hedera EVM, then register
// the Kickoff seller agent so it has a trustless on-chain identity.
//   node scripts/deploy-erc8004.js
import 'dotenv/config';
import solc from 'solc';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const AGENT_DOMAIN = process.env.ERC8004_AGENT_DOMAIN || 'kickoffseller.eth';

const source = readFileSync('contracts/ERC8004IdentityRegistry.sol', 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'ERC8004IdentityRegistry.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (output.errors || []).filter((e) => e.severity === 'error');
if (errs.length) { errs.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
const artifact = output.contracts['ERC8004IdentityRegistry.sol'].ERC8004IdentityRegistry;
mkdirSync('contracts/artifacts', { recursive: true });
writeFileSync('contracts/artifacts/ERC8004IdentityRegistry.json', JSON.stringify({ abi: artifact.abi, bytecode: '0x' + artifact.evm.bytecode.object }, null, 2));
console.log('Compiled OK.');

const RPC = process.env.HEDERA_JSON_RPC_URL || 'https://testnet.hashio.io/api';
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(process.env.EVM_OPERATOR_PRIVATE_KEY, provider);
console.log('Deployer / agent address:', wallet.address);

// Hedera EVM (hashio) needs an explicit, generous gas price/limit.
const fee = await provider.getFeeData();
const gasPrice = fee.gasPrice ? (fee.gasPrice * 13n) / 10n : ethers.parseUnits('600', 'gwei');
console.log('gasPrice:', ethers.formatUnits(gasPrice, 'gwei'), 'gwei');

const factory = new ethers.ContractFactory(artifact.abi, '0x' + artifact.evm.bytecode.object, wallet);
const registry = await factory.deploy({ gasLimit: 4_000_000, gasPrice });
await registry.waitForDeployment();
const address = await registry.getAddress();
console.log('ERC8004IdentityRegistry deployed at:', address);

// Register the seller agent (domain ⇄ address).
const tx = await registry.newAgent(AGENT_DOMAIN, wallet.address, { gasLimit: 500_000, gasPrice });
const receipt = await tx.wait();
const agentId = (await registry.resolveByAddress(wallet.address)).agentId.toString();
console.log(`Registered agent "${AGENT_DOMAIN}" → agentId ${agentId} (tx ${receipt.hash})`);

// Persist to .env
let env = readFileSync('.env', 'utf8');
const set = (k, v) => {
  env = env.includes(`${k}=`) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : env + `${k}=${v}\n`;
};
set('ERC8004_REGISTRY_ADDRESS', address);
set('ERC8004_AGENT_ID', agentId);
set('ERC8004_AGENT_DOMAIN', AGENT_DOMAIN);
set('ERC8004_REGISTER_TX', receipt.hash);
writeFileSync('.env', env);
console.log('Wrote ERC8004_* to .env');
