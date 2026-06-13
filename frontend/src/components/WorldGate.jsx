// World ID gate — "verify you're human to make an offer".
// Renders only when the backend reports World ID is configured. On success it
// posts the proof to the backend (server-side verification, bound to this
// listing scope), then calls onVerified so offering unlocks. Non-breaking: if
// World ID isn't configured, the gate is invisible and offers flow normally.
import { useEffect, useState } from 'react';
import { IDKitWidget, VerificationLevel } from '@worldcoin/idkit';
import { useTranslation } from 'react-i18next';

export default function WorldGate({ scope, onVerified }) {
  const { i18n } = useTranslation();
  const es = i18n.language === 'es';
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/world/config').then((r) => r.json()).then(setCfg).catch(() => setCfg({ enabled: false }));
  }, []);

  // Not configured → no gate (demo keeps working).
  if (!cfg) return null;
  if (!cfg.enabled) {
    // Auto-pass so the flow is unblocked when World ID isn't set up.
    return null;
  }

  async function handleVerify(proof) {
    const res = await fetch('/api/world/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proof, scope }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || 'verification failed');
    }
  }

  return (
    <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
        {es ? 'Verifica que eres humano para ofertar (anti-bots)' : "Verify you're human to make an offer (anti-bot)"}
      </div>
      <IDKitWidget
        app_id={cfg.appId}
        action={cfg.action}
        signal={scope}
        verification_level={VerificationLevel.Device}
        handleVerify={handleVerify}
        onSuccess={() => onVerified?.()}
      >
        {({ open }) => (
          <button
            className="btn-lg"
            style={{ width: '100%' }}
            onClick={() => { setError(null); open(); }}
          >
            🌍 {es ? 'Verificar con World ID' : 'Verify with World ID'}
          </button>
        )}
      </IDKitWidget>
      {error && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 8 }}>{error}</div>}
    </div>
  );
}
