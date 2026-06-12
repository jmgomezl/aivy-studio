// One command to prep everything before the demo:
//   node scripts/demo-setup.js
// 1. Checks balances (operator / seller agent / vault)
// 2. Commits the REAL min price hash on-chain (keccak256(minPrice, salt) +
//    collateral) so the post-deal reveal is cryptographically backed
// 3. Health-checks: HCS-10 topic, OpenAI, ElevenLabs, Telegram
// 4. Prints the demo checklist
import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync } from 'node:fs';

const MIRROR = 'https://testnet.mirrornode.hedera.com';
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
let failures = 0;

console.log('\n☕ KICKOFF.BOT — demo setup\n');

// ── 1. balances ──
console.log('Balances:');
for (const [label, id] of [
  ['operator/escrow', process.env.HEDERA_OPERATOR_ID],
  ['seller agent', process.env.SELLER_AGENT_ACCOUNT_ID],
  ['vault (Ledger-gated)', process.env.SELLER_VAULT_ACCOUNT_ID],
]) {
  const r = await fetch(`${MIRROR}/api/v1/accounts/${id}`).then((x) => x.json());
  const hbar = r.balance.balance / 1e8;
  hbar > 5 ? ok(`${label} ${id}: ${hbar} ℏ`) : (bad(`${label} ${id}: only ${hbar} ℏ`), failures++);
}

// ── 2. on-chain commitment ──
console.log('Commitment:');
const minPrice = Number(process.env.SELLER_MIN_PRICE_HBAR || 25);
const { abi } = JSON.parse(readFileSync('contracts/artifacts/KickoffCommitment.json', 'utf8'));
const provider = new ethers.JsonRpcProvider(process.env.HEDERA_JSON_RPC_URL || 'https://testnet.hashio.io/api');
const wallet = new ethers.Wallet(process.env.EVM_OPERATOR_PRIVATE_KEY, provider);
const contract = new ethers.Contract(process.env.COMMITMENT_CONTRACT_ADDRESS, abi, wallet);

const existing = await contract.getCommitment(wallet.address);
if (existing[0] !== ethers.ZeroHash && !existing[2]) {
  ok(`active commitment already on-chain (hash ${existing[0].slice(0, 14)}…)`);
} else {
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const minTinybar = ethers.parseUnits(String(minPrice), 8);
  const hash = ethers.solidityPackedKeccak256(['uint256', 'bytes32'], [minTinybar, salt]);
  const tx = await contract.commit(hash, { value: ethers.parseEther('5') });
  await tx.wait();
  // persist the salt — needed for the on-chain reveal after the deal
  let env = readFileSync('.env', 'utf8');
  for (const [k, v] of Object.entries({ SELLER_COMMIT_SALT: salt, SELLER_MIN_PRICE_HBAR: String(minPrice) })) {
    env = env.includes(`${k}=`) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : env + `${k}=${v}\n`;
  }
  writeFileSync('.env', env);
  ok(`committed keccak256(${minPrice} HBAR, salt) on-chain — tx ${tx.hash.slice(0, 14)}… · salt saved to .env`);
}

// ── 3. health checks ──
console.log('Services:');
const topic = await fetch(`${MIRROR}/api/v1/topics/${process.env.HCS10_NEGOTIATION_TOPIC}/messages?limit=1&order=desc`).then((x) => x.json());
topic.messages?.length ? ok(`HCS-10 topic ${process.env.HCS10_NEGOTIATION_TOPIC} (tip seq ${topic.messages[0].sequence_number})`) : (bad('HCS-10 topic unreachable'), failures++);

const oa = await fetch('https://api.openai.com/v1/models/gpt-4o', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
oa.ok ? ok('OpenAI key valid') : (bad(`OpenAI: HTTP ${oa.status} — agent will use deterministic fallback`), failures++);

const el = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
el.ok ? ok('ElevenLabs key valid') : (bad(`ElevenLabs: HTTP ${el.status} — verdicts will be text-only`), failures++);

const tg = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`).then((x) => x.json());
tg.ok ? ok(`Telegram bot @${tg.result.username}`) : (bad('Telegram token invalid'), failures++);

// ── 4. checklist ──
console.log(`
Demo checklist:
  📺 Projector: https://arena.kickoff.bot
  📱 Phone: @cryptokickoffbot → menu button (Mini App) — CLOSE AND REOPEN to bust cache
  ☕ Coffee on the table
  🔐 Vault threshold: ${process.env.LEDGER_THRESHOLD_HBAR || 50} HBAR (above → Ledger)
  💰 Settlement cap: ${process.env.DEMO_SETTLE_HBAR || 1} HBAR per deal (testnet budget guard)
  🔓 After an accepted deal, reveal on-chain: node scripts/reveal-onchain.js
${failures ? `\n⚠️  ${failures} check(s) failed — fix before the demo.` : '\n🟢 All checks passed. Break a leg.'}`);
process.exit(failures ? 1 : 0);
