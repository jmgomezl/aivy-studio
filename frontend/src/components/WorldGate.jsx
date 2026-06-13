// World ID 4.0 gate — "verify you're a unique human to make an offer".
// Flow: fetch an RP signature from our backend → open the IDKit 4.0 request
// widget (QR for World App) → on proof, our backend verifies via
// /api/v4/verify/{rp_id} and enforces one-offer-per-human. Non-breaking: if
// World ID isn't configured, the gate is invisible and offers flow normally.
import { useEffect, useState } from 'react';
import { IDKitRequestWidget, proofOfHuman } from '@worldcoin/idkit';
import { useTranslation } from 'react-i18next';

export default function WorldGate({ scope, onVerified }) {
  const { i18n } = useTranslation();
  const es = i18n.language === 'es';
  const [cfg, setCfg] = useState(null);
  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/world/config').then((r) => r.json()).then(setCfg).catch(() => setCfg({ enabled: false }));
  }, []);

  if (!cfg || !cfg.enabled) return null; // non-breaking when unconfigured

  async function begin() {
    setError(null);
    setBusy(true);
    try {
      const sig = await fetch('/api/world/rp-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: cfg.action }),
      }).then((r) => r.json());
      setRpContext({
        rp_id: cfg.rpId,
        nonce: sig.nonce,
        created_at: sig.created_at,
        expires_at: sig.expires_at,
        signature: sig.sig,
      });
      setOpen(true);
    } catch {
      setError(es ? 'No se pudo iniciar la verificación' : 'Could not start verification');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(result) {
    const res = await fetch('/api/world/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idkitResponse: result, scope }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || 'verification failed');
    }
  }

  return (
    <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
        {es ? 'Verifica que eres humano para ofertar (anti-bots · World ID)' : "Verify you're a unique human to make an offer (anti-bot · World ID)"}
      </div>
      <button className="btn-lg" style={{ width: '100%', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={begin}>
        🌍 {busy ? (es ? 'Iniciando…' : 'Starting…') : (es ? 'Verificar con World ID' : 'Verify with World ID')}
      </button>
      {error && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 8 }}>{error}</div>}

      {rpContext && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={cfg.appId}
          action={cfg.action}
          rp_context={rpContext}
          environment="production"
          allow_legacy_proofs={true}
          preset={proofOfHuman({ signal: scope })}
          handleVerify={handleVerify}
          onSuccess={() => { setOpen(false); onVerified?.(); }}
          onError={(e) => setError(e?.code || (es ? 'Verificación cancelada' : 'Verification cancelled'))}
        />
      )}
    </div>
  );
}
