// Seller listings — create a product to sell with a SECRET reserve price
// committed on-chain (reuses the commitment contract + the account foundation:
// each seller gets their own wallet and commits from their own EVM address, so
// the dramatic reveal at deal-close is cryptographically backed).
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import {
  Client,
  PrivateKey,
  AccountCreateTransaction,
  Hbar,
} from '@hashgraph/sdk';

const MIRROR = process.env.MIRROR_NODE_URL || 'https://testnet.mirrornode.hedera.com';

// Wait until the relay/mirror node has indexed an EVM address (post account
// creation) so it's recognized as a transaction sender.
async function waitForEvmAccount(evmAddress, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${MIRROR}/api/v1/accounts/${evmAddress}`);
    if (r.ok) return true;
    await new Promise((s) => setTimeout(s, 1500));
  }
  return false;
}
import { createManagedWallet } from './lib/wallet.js';
import { decryptSecret } from './lib/keyvault.js';

const RPC = process.env.HEDERA_JSON_RPC_URL || 'https://testnet.hashio.io/api';
const ACTIVE_FILE = 'data/active-listing.json';
const LISTINGS_FILE = 'data/listings.json';

mkdirSync('data', { recursive: true });
mkdirSync('uploads', { recursive: true });

let listings = existsSync(LISTINGS_FILE) ? JSON.parse(readFileSync(LISTINGS_FILE, 'utf8')) : [];
let secrets = {}; // listingId -> { minPriceHbar, salt } — server-only, never serialized to clients

function persist() {
  // Public listings only (no minPrice / salt).
  writeFileSync(LISTINGS_FILE, JSON.stringify(listings, null, 2));
}

function operatorClient() {
  const c = Client.forTestnet();
  c.setOperator(process.env.HEDERA_OPERATOR_ID, PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY));
  return c;
}

function savePhoto(id, dataUrl) {
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  const path = `uploads/${id}.${ext}`;
  writeFileSync(path, Buffer.from(m[2], 'base64'));
  return `/${path}`;
}

export function getPublicListings() {
  return listings;
}

export function getActiveListing() {
  return existsSync(ACTIVE_FILE) ? JSON.parse(readFileSync(ACTIVE_FILE, 'utf8')) : null;
}

/** Mark a listing sold (deal accepted). Clears the active pointer if it was active. */
export function markSold(listingId, soldPrice) {
  const l = listings.find((x) => x.id === listingId);
  if (!l || l.status === 'sold') return false;
  l.status = 'sold';
  l.soldPrice = soldPrice;
  persist();
  const active = getActiveListing();
  if (active?.id === listingId) {
    try { writeFileSync(ACTIVE_FILE, JSON.stringify({})); } catch {}
  }
  return true;
}

const commitmentAbi = [
  'function commit(bytes32 hash) payable',
  'function getCommitment(address) view returns (bytes32,uint256,bool,uint256)',
];

/**
 * Create a listing. Commits keccak256(minPrice, salt) on-chain from a fresh
 * seller wallet, writes the active-listing file the agent reads, returns the
 * public listing (no secret price).
 */
export async function createListing({ name, description, minPriceHbar, photoDataUrl, seller }) {
  if (!name || !Number(minPriceHbar)) throw new Error('name and minPriceHbar required');
  const id = `lst-${Date.now().toString(36)}`;
  const photoUrl = savePhoto(id, photoDataUrl);

  // Seller identity = a managed wallet (account foundation).
  const wallet = await createManagedWallet();
  const keyHex = await decryptSecret(wallet.encryptedKey);
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const minTinybar = ethers.parseUnits(String(minPriceHbar), 8);
  const commitHash = ethers.solidityPackedKeccak256(['uint256', 'bytes32'], [minTinybar, salt]);

  let commitmentTx = null;
  let onChain = false;
  if (process.env.COMMITMENT_CONTRACT_ADDRESS) {
    try {
      // Create the seller as a FULL ECDSA account with EVM alias (relay-recognized),
      // funded for gas + collateral.
      const client = operatorClient();
      const sellerKey = PrivateKey.fromStringECDSA(keyHex);
      await (
        await new AccountCreateTransaction()
          .setECDSAKeyWithAlias(sellerKey)
          .setInitialBalance(new Hbar(3))
          .setAccountMemo(`kickoff seller ${id}`)
          .execute(client)
      ).getReceipt(client);
      client.close();

      await waitForEvmAccount(wallet.evmAddress); // let the relay index it

      const provider = new ethers.JsonRpcProvider(RPC);
      const signer = new ethers.Wallet('0x' + keyHex, provider);
      const contract = new ethers.Contract(process.env.COMMITMENT_CONTRACT_ADDRESS, commitmentAbi, signer);
      const tx = await contract.commit(commitHash, { value: ethers.parseEther('1') });
      await tx.wait();
      commitmentTx = tx.hash;
      onChain = true;
    } catch (err) {
      console.warn('[listings] on-chain commit failed (listing still created):', err.message);
    }
  }

  const listing = {
    id,
    name,
    description: description || '',
    photoUrl,
    seller: seller || 'anonymous',
    sellerEvm: wallet.evmAddress,
    commitHash,
    commitmentTx,
    onChain,
    status: 'live',
    createdAt: id,
  };
  listings.unshift(listing);
  secrets[id] = { minPriceHbar: Number(minPriceHbar), salt };
  persist();

  // Tell the agent which reserve to defend (server-only file, same box).
  writeFileSync(ACTIVE_FILE, JSON.stringify({ id, name, minPriceHbar: Number(minPriceHbar), commitHash, commitmentTx, onChain }));

  return listing; // public — no minPrice/salt
}

export function getListingSecret(id) {
  return secrets[id] ?? null;
}
