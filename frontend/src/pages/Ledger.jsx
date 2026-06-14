// /ledger — the human-in-the-loop Ledger approval demo. Lazy-loaded so the DMK
// bundle only loads here. Shows a pending high-value agent settlement that
// requires a physical Ledger Clear-Sign before it can execute.
import { useSearchParams, useNavigate } from 'react-router-dom';
import LedgerApprove from '../components/LedgerApprove.jsx';

export default function Ledger() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const negotiationId = params.get('id') || null;
  const amountUsd = Number(params.get('amount') || 500);
  const recipient = params.get('to') || null;
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 16px' }}>
      <button onClick={goBack} className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12, marginBottom: 16 }}>
        ← Back to Kickoff
      </button>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>⬡ KICKOFF · LEDGER-SECURED SETTLEMENT</div>
      <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>Ledger as the trust layer for agents</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 20 }}>
        Kickoff's agents settle small deals autonomously. Above the autonomy threshold, the deal becomes a
        <b> human-in-the-loop </b> action: it can only execute once a human Clear-Signs it on a physical Ledger.
        The device is the final confirmation gate.
      </p>
      <LedgerApprove negotiationId={negotiationId} amountUsd={amountUsd} recipient={recipient} />
    </div>
  );
}
