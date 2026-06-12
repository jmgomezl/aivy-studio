// Creates the seller vault account. Its key is the SELLER's key — in production
// this is the Ledger; for now a software stand-in. Above-threshold settlements
// debit the vault, so they stay pending until this key signs.
import 'dotenv/config';
import { Client, PrivateKey, AccountCreateTransaction, Hbar } from '@hashgraph/sdk';
import { readFileSync, writeFileSync } from 'node:fs';

const client = Client.forTestnet();
client.setOperator(process.env.HEDERA_OPERATOR_ID, PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY));

const vaultKey = PrivateKey.generateECDSA();
const tx = await new AccountCreateTransaction()
  .setKey(vaultKey.publicKey)
  .setInitialBalance(new Hbar(100))
  .setAccountMemo('kickoff seller vault (Ledger-gated)')
  .execute(client);
const vaultId = (await tx.getReceipt(client)).accountId.toString();
console.log('Seller vault created:', vaultId);

let env = readFileSync('.env','utf8');
if (!env.includes('SELLER_VAULT_ACCOUNT_ID=')) env += '\n# Seller vault (Ledger-gated above threshold)\n';
for (const [k,v] of Object.entries({SELLER_VAULT_ACCOUNT_ID: vaultId, SELLER_VAULT_KEY: vaultKey.toString(), LEDGER_THRESHOLD_HBAR: '50'})) {
  const line = `${k}=${v}`;
  env = env.includes(`${k}=`) ? env.replace(new RegExp(`^${k}=.*$`,'m'), line) : env + line + '\n';
}
writeFileSync('.env', env);
console.log('Vault credentials written to .env');
client.close();
