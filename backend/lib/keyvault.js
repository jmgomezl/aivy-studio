// Envelope encryption for custodial keys.
// Uses AWS KMS when AWS_KMS_KEY_ID is configured; otherwise a local AES-256-GCM
// master key (dev fallback). Mirrors the Aivy custody pattern so Kickoff can
// later point at the same KMS. The private key is only ever stored as ciphertext.
import crypto from 'node:crypto';

const KMS_KEY_ID = process.env.AWS_KMS_KEY_ID;

// ── local dev master key (AES-256-GCM) ──
function localMasterKey() {
  const hex = process.env.KEYVAULT_MASTER_KEY;
  if (hex) {
    const buf = Buffer.from(hex, 'hex');
    if (buf.length !== 32) throw new Error('KEYVAULT_MASTER_KEY must be 32 bytes hex');
    return buf;
  }
  // Ephemeral key — fine for a single-process demo; warns so it isn't shipped silently.
  if (!localMasterKey._warned) {
    console.warn('[keyvault] no KEYVAULT_MASTER_KEY/AWS_KMS_KEY_ID — using ephemeral dev key (not for prod)');
    localMasterKey._warned = true;
  }
  return (localMasterKey._k ??= crypto.randomBytes(32));
}

function localEncrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', localMasterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `local:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

function localDecrypt(blob) {
  const [, ivH, tagH, ctH] = blob.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', localMasterKey(), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]).toString('utf8');
}

// ── AWS KMS envelope (used when configured) ──
async function kmsEncrypt(plaintext) {
  const { KMSClient, GenerateDataKeyCommand } = await import('@aws-sdk/client-kms');
  const client = new KMSClient({});
  const { Plaintext, CiphertextBlob } = await client.send(
    new GenerateDataKeyCommand({ KeyId: KMS_KEY_ID, KeySpec: 'AES_256' })
  );
  const dataKey = Buffer.from(Plaintext);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  dataKey.fill(0); // wipe plaintext data key from memory
  return `kms:${Buffer.from(CiphertextBlob).toString('base64')}:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

async function kmsDecrypt(blob) {
  const { KMSClient, DecryptCommand } = await import('@aws-sdk/client-kms');
  const [, edkB64, ivH, tagH, ctH] = blob.split(':');
  const client = new KMSClient({});
  const { Plaintext } = await client.send(
    new DecryptCommand({ CiphertextBlob: Buffer.from(edkB64, 'base64') })
  );
  const dataKey = Buffer.from(Plaintext);
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]).toString('utf8');
  dataKey.fill(0);
  return pt;
}

export async function encryptSecret(plaintext) {
  return KMS_KEY_ID ? kmsEncrypt(plaintext) : localEncrypt(plaintext);
}

export async function decryptSecret(blob) {
  return blob.startsWith('kms:') ? kmsDecrypt(blob) : localDecrypt(blob);
}

export const vaultBackend = KMS_KEY_ID ? 'aws-kms' : 'local-dev';
