// Human-verification gate offered when a seller requires it. TWO methods, so
// buyers who distrust World App's biometrics have a privacy-friendly path:
//   • World ID  — Orb-grade proof-of-human (strongest sybil resistance)
//   • Telegram  — a real Telegram account, no biometrics (privacy-friendly)
// Either one satisfies the requirement.
import { useTranslation } from 'react-i18next';
import WorldGate from './WorldGate.jsx';
import TelegramLogin from './TelegramLogin.jsx';

export default function VerifyGate({ worldEnabled, scope, onWorldVerified, onTgChange }) {
  const { i18n } = useTranslation();
  const es = i18n.language === 'es';
  return (
    <div className="verify-gate">
      <div className="vg-head">🔒 {es ? 'Verificación humana requerida' : 'Human verification required'}</div>
      <div className="vg-sub">
        {es
          ? 'Este vendedor exige que verifiques que eres humano. Elige un método:'
          : "This seller requires you to verify you're human. Pick a method:"}
      </div>
      <div className="vg-methods">
        {worldEnabled && (
          <div className="vg-method">
            <div className="vg-method-tag">🌍 World ID · <em>{es ? 'prueba con Orb' : 'Orb-grade'}</em></div>
            <WorldGate scope={scope} onVerified={onWorldVerified} />
          </div>
        )}
        <div className="vg-method">
          <div className="vg-method-tag">✈️ Telegram · <em>{es ? 'privado · sin biometría' : 'private · no biometrics'}</em></div>
          <TelegramLogin role="buyer" es={es} onChange={onTgChange} />
        </div>
      </div>
    </div>
  );
}
