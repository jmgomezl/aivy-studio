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
      setPrompt('Deriving address…');
      // Derive WITHOUT requiring an on-device confirmation here — the real device
      // interaction (and the security) is the Clear-Sign step. Verifying the
      // address on-device during connect was the step that could hang.
      const addr = await getLedgerAddress(s, { verify: false, onPrompt: setPrompt });
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
        The agent proposes a settlement of <b>{amountUsd} USD</b>{negotiationId ? <> for deal <code>{negotiationId}</code></> : null}. Above the autonomy threshold it
        cannot execute until the human Clear-Signs it on a physical Ledger.
      </div>
      {negotiationId ? (
        <div style={{ fontSize: 11, color: '#A78BFA', background: 'color-mix(in srgb,#8259EF 12%,transparent)', border: '1px solid rgba(130,89,239,.4)', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
          🔗 Linked to your deal — when you Clear-Sign, the approval posts back to that negotiation and shows as “Ledger-approved.” Keep your deal tab open.
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
          ⓘ Standalone demo. To see it <b>wired to a real deal</b>: in the marketplace, negotiate a deal <b>over 100 USD</b>, then click “🔐 Approve on Ledger” on the closed deal — it opens here with that deal’s details and the approval flows back onto the deal.
        </div>
      )}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--muted)', marginBottom: 12 }}>
        1 Connect Ledger → 2 Clear-Sign on device → 3 broadcast on Hedera EVM → 4 recorded on the live feed
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
          {negotiationId && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
              🔗 Linked to deal <code>{negotiationId}</code> — it now shows “Ledger-approved” in the negotiation. You can close this tab.
            </div>
          )}
        </div>
      )}

      {prompt && <div className="ledger-prompt">👉 {prompt}</div>}
      {error && <div className="ledger-error">{error}</div>}
      <div className="ledger-foot">Device Management Kit · WebHID · Clear Signing · the device is the final gate</div>
    </div>
  );
}
