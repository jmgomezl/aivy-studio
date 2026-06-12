import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'node:fs';
const { abi } = JSON.parse(readFileSync('contracts/artifacts/KickoffCommitment.json','utf8'));
const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
const wallet = new ethers.Wallet(process.env.EVM_OPERATOR_PRIVATE_KEY, provider);
const c = new ethers.Contract(process.env.COMMITMENT_CONTRACT_ADDRESS, abi, wallet);
const minPrice = ethers.parseUnits('25', 8); // 25 HBAR in tinybar
const salt = ethers.id('smoke-test-salt');
const hash = ethers.solidityPackedKeccak256(['uint256','bytes32'], [minPrice, salt]);
let tx = await c.commit(hash, { value: ethers.parseEther('1') });
await tx.wait();
console.log('commit OK');
tx = await c.reveal(minPrice, salt);
await tx.wait();
const r = await c.getCommitment(wallet.address);
console.log('reveal OK — revealed:', r[2], 'minPrice (tinybar):', r[3].toString());
