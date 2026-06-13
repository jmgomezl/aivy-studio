// One secp256k1 key → a Hedera account AND an EVM address.
// Because the operator/agent accounts are ECDSA_SECP256K1 (same curve as EVM),
// a single key serves both chains. The EVM address IS the Hedera EVM-alias, so
// the Hedera account auto-creates on first transfer to that alias — no HBAR
// spent to provision an identity.
import { PrivateKey, AccountId, AccountCreateTransaction, Hbar } from '@hashgraph/sdk';
import { ethers } from 'ethers';
import { encryptSecret, decryptSecret } from './keyvault.js';

/** Generate a fresh secp256k1 keypair and derive both-chain identities. */
export function generateKey() {
  const hederaKey = PrivateKey.generateECDSA();
  return fromRawHex(hederaKey.toStringRaw());
}

export function fromRawHex(rawHex) {
  const hex = rawHex.startsWith('0x') ? rawHex.slice(2) : rawHex;
  const hederaKey = PrivateKey.fromStringECDSA(hex);
  const evm = new ethers.Wallet('0x' + hex);
  const evmAddress = ethers.getAddress(evm.address);
  return {
    privateKeyHex: hex,
    publicKeyHex: hederaKey.publicKey.toStringRaw(),
    evmAddress,
    // Hedera account reference via EVM alias (auto-creates on first transfer)
    hederaAlias: AccountId.fromEvmAddress(0, 0, evmAddress).toString(),
  };
}

/** Build the encrypted, storable record for a wallet. */
export async function createManagedWallet() {
  const k = generateKey();
  return {
    custody: 'managed', // KMS / envelope
    publicKeyHex: k.publicKeyHex,
    evmAddress: k.evmAddress,
    hederaAlias: k.hederaAlias,
    encryptedKey: await encryptSecret(k.privateKeyHex),
  };
}

/** Self-custody (Ledger): we store only the device-derived public identities. */
export function createSelfCustodyWallet({ evmAddress, publicKeyHex }) {
  const addr = ethers.getAddress(evmAddress);
  return {
    custody: 'self-custody', // Ledger holds the key
    publicKeyHex: publicKeyHex ?? null,
    evmAddress: addr,
    hederaAlias: AccountId.fromEvmAddress(0, 0, addr).toString(),
    encryptedKey: null, // never held server-side
  };
}

/** Sign an EVM digest with a managed wallet (decrypt → sign → wipe). */
export async function signEvmDigest(record, digestHex) {
  if (record.custody !== 'managed') throw new Error('signEvmDigest requires a managed wallet');
  const hex = await decryptSecret(record.encryptedKey);
  const signing = new ethers.SigningKey('0x' + hex);
  return signing.sign(digestHex).serialized;
}

/** Provision the real on-chain Hedera account (optional — only when funding it). */
export async function provisionHederaAccount(record, operatorClient, initialHbar = 0) {
  const hederaKey = PrivateKey.fromStringECDSA(await decryptSecret(record.encryptedKey));
  const tx = await new AccountCreateTransaction()
    .setKeyWithoutAlias(hederaKey.publicKey)
    .setInitialBalance(new Hbar(initialHbar))
    .execute(operatorClient);
  const accountId = (await tx.getReceipt(operatorClient)).accountId.toString();
  return accountId;
}
