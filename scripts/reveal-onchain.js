// Reveals the seller's committed minimum on the contract after the deal closes
// (collateral returns automatically on a correct reveal), then publishes the
// proof to the HCS-10 topic so the Arena can show "verified on-chain".
import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'node:fs';
import { Client, PrivateKey, TopicMessageSubmitTransaction } from '@hashgraph/sdk';

const { abi } = JSON.parse(readFileSync('contracts/artifacts/KickoffCommitment.json', 'utf8'));
const provider = new ethers.JsonRpcProvider(process.env.HEDERA_JSON_RPC_URL || 'https://testnet.hashio.io/api');
const wallet = new ethers.Wallet(process.env.EVM_OPERATOR_PRIVATE_KEY, provider);
const contract = new ethers.Contract(process.env.COMMITMENT_CONTRACT_ADDRESS, abi, wallet);

const minTinybar = ethers.parseUnits(process.env.SELLER_MIN_PRICE_HBAR || '25', 8);
const tx = await contract.reveal(minTinybar, process.env.SELLER_COMMIT_SALT);
const receipt = await tx.wait();
console.log('Revealed on-chain:', tx.hash);

const client = Client.forTestnet();
client.setOperator(process.env.HEDERA_OPERATOR_ID, PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY));
await (
  await new TopicMessageSubmitTransaction()
    .setTopicId(process.env.HCS10_NEGOTIATION_TOPIC)
    .setMessage(
      JSON.stringify({
        p: 'hcs-10',
        op: 'message',
        type: 'commitment_revealed',
        minPrice: Number(process.env.SELLER_MIN_PRICE_HBAR || 25),
        contract: process.env.COMMITMENT_CONTRACT_ADDRESS,
        txHash: tx.hash,
        block: receipt.blockNumber,
      })
    )
    .execute(client)
).getReceipt(client);
console.log('Proof published to HCS-10 topic.');
client.close();
