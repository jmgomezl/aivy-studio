// Telegram Login Widget auth — lets a web seller (on a PC) prove the same
// Telegram identity they'd have in the Mini App, WITHOUT a crypto wallet. We
// verify the widget's HMAC signature (per Telegram's spec), then mint/lookup a
// persistent managed wallet for that Telegram id (the "account foundation" — the
// user never sees a key). A short signed session token carries the verified
// identity to later requests (so the client can't forge a seller).
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createManagedWallet } from './lib/wallet.js';
import { provisionAndFund, faucetEnabled } from './lib/faucet.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
// Session-signing secret. Falls back to a key derived from the bot token so no
// extra env is required, but SESSION_SECRET should be set in production.
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('kickoff-session::' + BOT_TOKEN).digest('hex');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const AUTH_MAX_AGE_S = 24 * 60 * 60; // widget payload must be < 24h old

export const telegramAuthEnabled = !!BOT_TOKEN;

const SELLERS_FILE = 'data/sellers.json';
mkdirSync('data', { recursive: true });
let sellers = existsSync(SELLERS_FILE) ? JSON.parse(readFileSync(SELLERS_FILE, 'utf8')) : {};

function persistSellers() {
  writeFileSync(SELLERS_FILE, JSON.stringify(sellers, null, 2));
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(s, 'base64url').toString('utf8');

/**
 * Verify a Telegram Login Widget payload. Returns { ok, profile } or { ok:false }.
 * Spec: secret = SHA256(bot_token); the HMAC-SHA256 of the data-check-string
 * (every field except `hash`, sorted, joined "key=value" by "\n") must equal `hash`.
 */
export function verifyTelegramAuth(payload) {
  if (!BOT_TOKEN || !payload || typeof payload !== 'object') return { ok: false, reason: 'unconfigured' };
  const { hash, ...fields } = payload;
  if (!hash || !fields.id) return { ok: false, reason: 'missing-fields' };

  const dataCheckString = Object.keys(fields)
    .filter((k) => fields[k] !== undefined && fields[k] !== null)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');

  const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  // constant-time compare
  const a = Buffer.from(hmac);
  const b = Buffer.from(String(hash));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad-hash' };

  const authDate = Number(fields.auth_date || 0);
  if (!authDate || Date.now() / 1000 - authDate > AUTH_MAX_AGE_S) return { ok: false, reason: 'expired' };

  return {
    ok: true,
    profile: {
      telegramId: String(fields.id),
      username: fields.username || null,
      firstName: fields.first_name || null,
      photoUrl: fields.photo_url || null,
    },
  };
}

/**
 * Persistent managed wallet per Telegram id — created once, reused after. This
 * is the wallet "associated with the Telegram identity"; its EVM address is the
 * seller's stable on-chain handle.
 */
export async function getOrCreateSellerWallet(profile, { operatorClient } = {}) {
  const id = profile.telegramId;
  if (sellers[id]?.evmAddress) {
    if (profile.username && sellers[id].username !== profile.username) {
      sellers[id].username = profile.username;
      persistSellers();
    }
    // Heal a wallet that exists but was never funded (e.g. faucet hiccup on first login).
    if (operatorClient && faucetEnabled() && !sellers[id].funded) {
      await fundSellerWallet(id, operatorClient);
    }
    return sellers[id];
  }
  const wallet = await createManagedWallet();
  sellers[id] = {
    telegramId: id,
    username: profile.username,
    evmAddress: wallet.evmAddress,
    hederaAlias: wallet.hederaAlias, // same key, Hedera EVM-alias account
    encryptedKey: wallet.encryptedKey,
    createdAt: new Date().toISOString(),
    funded: false,
  };
  persistSellers();
  // Provision the real on-chain account + grant KUSD so judges can test with real
  // balances. Best-effort: a faucet failure must not block login (wallet stands,
  // funding retries on next login via the heal path above).
  if (operatorClient && faucetEnabled()) {
    await fundSellerWallet(id, operatorClient);
  }
  return sellers[id];
}

async function fundSellerWallet(id, operatorClient) {
  try {
    const r = await provisionAndFund(sellers[id], operatorClient);
    sellers[id].hederaAccount = r.accountId;
    sellers[id].funded = true;
    sellers[id].fundedUsd = r.fundedUsd;
    sellers[id].gasHbar = r.gasHbar;
    sellers[id].fundedAt = new Date().toISOString();
    persistSellers();
  } catch (err) {
    console.warn(`[faucet] funding failed for ${id} (wallet stands):`, err.message);
  }
}

/** Issue a signed session token carrying the verified identity. */
export function issueSession(profile, walletEvm) {
  const body = b64url(
    JSON.stringify({
      telegramId: profile.telegramId,
      username: profile.username,
      walletEvm,
      exp: Date.now() + SESSION_TTL_MS,
    })
  );
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify a session token → the identity payload, or null. */
export function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(fromB64url(body));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
