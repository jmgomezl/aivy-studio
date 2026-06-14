// Ledger HITL approval panel — a high-value agent settlement only executes after
// the human Clear-Signs it on their physical Ledger (device-backed security as
// the final gate). Uses the Ledger Device Management Kit over WebHID.
import { useState } from 'react';
import { connectLedger, getLedgerAddress, clearSignAndBroadcast } from '../lib/ledger.js';

// Hedera EVM testnet (ties the approval to where Kickoff settles).
const CHAIN = {
  chainId: 296,
  rpcUrl: 'https://testnet.hashio.io/api',
  explorerTx: (h) => `https://hashscan.io/testnet/transaction/${h}`,
};

export default function LedgerApprove({ negotiationId, amountUsd = 500, recipient }) {
  const [session, setSession] = useState(null);
  const [address, setAddress] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const supported = typeof navigator !== 'undefined' && 'hid' in navigator;
  // Symbolic on-chain value (gas-budget safe); the USD figure is the real deal size.
  const valueWei = 100000000000000n; // 0.0001 HBAR-equiv

  async function connect() {
    setError(null); setBusy(true);
    try {
      const s = await connectLedger(setPrompt);
      setSession(s);
      setPrompt('Verify the address on your Ledger…');
      const addr = await getLedgerAddress(s, { verify: true, onPrompt: setPrompt });
      setAddress(addr);
      setPrompt(null);
    } catch (e) { setError(e.message || 'connection failed'); }
    finally { setBusy(false); }
  }

  async function approve() {
    setError(null); setBusy(true); setResult(null);
    try {
      // Make sure the Ledger has gas on Hedera EVM (operator tops it up, capped).
      await fetch(`/api/ledger/fund?address=${address}`).catch(() => {});
      const to = recipient || address; // settle to the seller; falls back to self for the demo
      setPrompt('Review & approve the settlement on your Ledger…');
      const r = await clearSignAndBroadcast(session, {
        to, valueWei: valueWei.toString(), ...CHAIN,
      }, setPrompt);
      setResult(r);
      setPrompt(null);
      // Record the device-approved settlement in the live feed.
      fetch('/api/ledger/approval', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negotiationId, amountUsd, signer: r.from, to: r.to, txHash: r.hash, chainId: r.chainId }),
      }).catch(() => {});
    } catch (e) { setError(e.message || 'signing failed'); setPrompt(null); }
    finally { setBusy(false); }
  }

  if (!supported) {
    return <div className="ledger-card"><div className="ledger-head">🔐 Ledger approval</div>
      <div className="ledger-sub">WebHID needs a Chromium browser (Chrome/Brave/Edge) over HTTPS. Open this on desktop Chrome to approve with your Ledger.</div></div>;
  }

  return (
    <div className="ledger-card">
      <div className="ledger-head">🔐 High-value settlement · Ledger approval required</div>
      <div className="ledger-sub">
        The agent proposes a settlement of <b>{amountUsd} USD</b>{negotiationId ? <> for <code>{negotiationId}</code></> : null}. Above the autonomy threshold it
        cannot execute until the human Clear-Signs it on a physical Ledger.
      </div>

      {!address ? (
        <button className="btn-lg" style={{ width: '100%', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={connect}>
          {busy ? 'Connecting…' : '🔌 Connect Ledger (WebHID)'}
        </button>
      ) : !result ? (
        <>
          <div className="ledger-addr">Signer: <b>{address.slice(0, 10)}…{address.slice(-6)}</b> <span className="ledger-ok">verified on device ✓</span></div>
          <button className="btn-lg" style={{ width: '100%', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={approve}>
            {busy ? 'Awaiting device…' : '🖊 Clear-Sign settlement on Ledger'}
          </button>
        </>
      ) : (
        <div className="ledger-done">
          ✅ Ledger-approved & broadcast ·{' '}
          <a href={result.explorer} target="_blank" rel="noreferrer">{result.hash.slice(0, 14)}… ↗</a>
        </div>
      )}

      {prompt && <div className="ledger-prompt">👉 {prompt}</div>}
      {error && <div className="ledger-error">{error}</div>}
      <div className="ledger-foot">Device Management Kit · WebHID · Clear Signing · the device is the final gate</div>
    </div>
  );
}
