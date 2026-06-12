// Compiles and deploys KickoffCommitment to Hedera testnet (EVM via JSON-RPC relay)
import 'dotenv/config';
import solc from 'solc';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const source = readFileSync('contracts/KickoffCommitment.sol', 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'KickoffCommitment.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((e) => e.severity === 'error');
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const artifact = output.contracts['KickoffCommitment.sol'].KickoffCommitment;
mkdirSync('contracts/artifacts', { recursive: true });
writeFileSync(
  'contracts/artifacts/KickoffCommitment.json',
  JSON.stringify({ abi: artifact.abi, bytecode: '0x' + artifact.evm.bytecode.object }, null, 2)
);
console.log('Compiled OK.');

const RPC = process.env.HEDERA_JSON_RPC_URL || 'https://testnet.hashio.io/api';
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(process.env.EVM_OPERATOR_PRIVATE_KEY, provider);
console.log('Deployer:', wallet.address);

const factory = new ethers.ContractFactory(artifact.abi, '0x' + artifact.evm.bytecode.object, wallet);
const contract = await factory.deploy();
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log('KickoffCommitment deployed at:', address);

// Persist into .env
const env = readFileSync('.env', 'utf8');
const line = `COMMITMENT_CONTRACT_ADDRESS=${address}`;
writeFileSync(
  '.env',
  env.includes('COMMITMENT_CONTRACT_ADDRESS=')
    ? env.replace(/^COMMITMENT_CONTRACT_ADDRESS=.*$/m, line)
    : env + `\n# Contracts\n${line}\n`
);
console.log('Wrote COMMITMENT_CONTRACT_ADDRESS to .env');
