// Create the Kickoff USD (KUSD) demo stablecoin on Hedera Token Service.
//   node scripts/create-stablecoin.js
// A faucet-style HTS fungible token so judges can test with "real" balances and
// we settle real amounts without burning the testnet HBAR faucet. Treasury =
// operator; operator holds admin + supply keys (demo token, operator-controlled).
import 'dotenv/config';
import {
  Client,
  PrivateKey,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  Hbar,
} from '@hashgraph/sdk';
import { readFileSync, writeFileSync } from 'node:fs';

const DECIMALS = 6;                              // USDC-style
const INITIAL_SUPPLY = 100_000_000;              // 100M KUSD pre-minted to treasury
const NAME = 'Kickoff USD';
const SYMBOL = 'KUSD';

const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKey = PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY);
const client = Client.forTestnet().setOperator(operatorId, operatorKey);

const tx = await new TokenCreateTransaction()
  .setTokenName(NAME)
  .setTokenSymbol(SYMBOL)
  .setTokenType(TokenType.FungibleCommon)
  .setDecimals(DECIMALS)
  .setInitialSupply(INITIAL_SUPPLY * 10 ** DECIMALS)
  .setTreasuryAccountId(operatorId)
  .setSupplyType(TokenSupplyType.Infinite)
  .setAdminKey(operatorKey.publicKey)
  .setSupplyKey(operatorKey.publicKey)
  .setMaxTransactionFee(new Hbar(40))
  .freezeWith(client);

const signed = await tx.sign(operatorKey);
const resp = await signed.execute(client);
const receipt = await resp.getReceipt(client);
const tokenId = receipt.tokenId.toString();
console.log(`${SYMBOL} created: ${tokenId} · ${INITIAL_SUPPLY.toLocaleString()} supply · ${DECIMALS} decimals · treasury ${operatorId}`);

let env = readFileSync('.env', 'utf8');
const set = (k, v) => {
  env = env.includes(`${k}=`) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : env + `${k}=${v}\n`;
};
set('KUSD_TOKEN_ID', tokenId);
set('KUSD_DECIMALS', String(DECIMALS));
writeFileSync('.env', env);
console.log('Wrote KUSD_TOKEN_ID + KUSD_DECIMALS to .env');
client.close();
