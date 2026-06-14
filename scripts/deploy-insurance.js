// Compile + deploy KickoffInsurance on Hedera EVM.
//   node scripts/deploy-insurance.js
import 'dotenv/config';
import solc from 'solc';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const source = readFileSync('contracts/KickoffInsurance.sol', 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'KickoffInsurance.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (output.errors || []).filter((e) => e.severity === 'error');
if (errs.length) { errs.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
const artifact = output.contracts['KickoffInsurance.sol'].KickoffInsurance;
mkdirSync('contracts/artifacts', { recursive: true });
writeFileSync('contracts/artifacts/KickoffInsurance.json', JSON.stringify({ abi: artifact.abi, bytecode: '0x' + artifact.evm.bytecode.object }, null, 2));
console.log('Compiled OK.');

const RPC = process.env.HEDERA_JSON_RPC_URL || 'https://testnet.hashio.io/api';
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(process.env.EVM_OPERATOR_PRIVATE_KEY, provider);
const fee = await provider.getFeeData();
const gasPrice = fee.gasPrice ? (fee.gasPrice * 13n) / 10n : ethers.parseUnits('600', 'gwei');
console.log('Deployer:', wallet.address, '| gasPrice', ethers.formatUnits(gasPrice, 'gwei'), 'gwei');

const factory = new ethers.ContractFactory(artifact.abi, '0x' + artifact.evm.bytecode.object, wallet);
const contract = await factory.deploy({ gasLimit: 2_500_000, gasPrice });
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log('KickoffInsurance deployed at:', address);

let env = readFileSync('.env', 'utf8');
const k = 'INSURANCE_CONTRACT_ADDRESS';
env = env.includes(`${k}=`) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${address}`) : env + `${k}=${address}\n`;
writeFileSync('.env', env);
console.log('Wrote INSURANCE_CONTRACT_ADDRESS to .env');
