// The live negotiation surface — shared by the Mini App (Offer page) and Arena.
// Everything rendered here comes from real backend events (HCS-10 via WS).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SELLER = { av: 'seller', label: 'CA' };

function meterColor(p) {
  return p > 65 ? 'var(--accent)' : p > 35 ? 'var(--yellow)' : 'var(--red)';
}

function time(ts) {
  const d = ts ? new Date(Number(String(ts).split('.')[0]) * 1000) : new Date();
  return d.toTimeString().slice(0, 8);
}

export default function NegotiationPanel({
  negotiation,
  onSubmitOffer,
  inputEnabled = true,
  buyerLabel,
  compact = false,
  item = null,
}) {
  const { t, i18n } = useTranslation();
  const [price, setPrice] = useState('');
  const [argument, setArgument] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState(null); // optimistic offer bubble
  const [error, setError] = useState(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const playedRef = useRef(new Set());
  const chatRef = useRef(null);

  const n = negotiation;
  const prob = n?.sellProbability;
  const verdict = n?.verdict;
  const evaluating = n?.status === 'evaluating' && !verdict;
  const lastOffer = n?.offers?.[n.offers.length - 1];

  // Interleave offers + reasoning + verdict into a chat timeline by sequence.
  const messages = useMemo(() => {
    if (!n) return [];
    const all = [
      ...n.offers.map((o) => ({ ...o, kind: 'offer' })),
      ...n.reasoning.map((r) => ({ ...r, kind: 'reasoning' })),
      ...(n.verdict ? [{ ...n.verdict, kind: 'verdict' }] : []),
    ];
    return all.sort((a, b) => a.sequence - b.sequence);
  }, [n]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, evaluating]);

  // Speak the verdict: play the agent's ElevenLabs audio when it arrives.
  useEffect(() => {
    const v = n?.verdict;
    if (!v?.audio || playedRef.current.has(v.sequence)) return;
    playedRef.current.add(v.sequence);
    new Audio(`/${v.audio}`).play().catch(() => setSoundBlocked(true));
  }, [n?.verdict]); // eslint-disable-line react-hooks/exhaustive-deps

  function enableSound() {
    setSoundBlocked(false);
    const v = n?.verdict;
    if (v?.audio) new Audio(`/${v.audio}`).play().catch(() => {});
  }

  // Clear the optimistic bubble once the real offer lands from the chain.
  useEffect(() => {
    if (pending && n?.offers?.some((o) => o.price === pending.price && o.argument === pending.argument)) {
      setPending(null);
    }
  }, [n?.offers?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    const p = parseFloat(price);
    if (sending) return;
    if (!p || p < 1) {
      setError(i18n.language === 'es' ? 'Pon un precio en HBAR (mín. 1)' : 'Enter a price in HBAR (min 1)');
      return;
    }
    if (argument.trim().length < 5) {
      setError(i18n.language === 'es' ? 'Cuéntale al agente por qué lo mereces' : 'Tell the agent why you deserve it');
      return;
    }
    setError(null);
    setSending(true);
    const offer = { price: p, argument: argument.trim() };
    setPending(offer); // instant feedback — bubble appears immediately
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('medium');
    try {
      await onSubmitOffer(p, offer.argument);
      setPrice('');
      setArgument('');
    } catch (err) {
      setPending(null);
      setError(i18n.language === 'es' ? 'No se pudo enviar — reintenta' : 'Could not send — try again');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="neg-panel">
      <div className="neg-item-header">
        <div className="neg-eyebrow">{t('liveNegotiation')}</div>
        <div className="neg-item-row">
          <div className="neg-emoji" style={item?.photoUrl ? { padding: 0, overflow: 'hidden' } : undefined}>
            {item?.photoUrl ? <img src={item.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '☕'}
          </div>
          <div>
            <div className="neg-item-name">{item?.name || t('coffeeName')}</div>
            <div className="neg-item-sub">Kickoff Seller Agent · 0.0.9217340 · Hedera</div>
          </div>
          <div className="neg-price-area">
            <div className="neg-price-val" style={{ color: prob != null ? meterColor(prob) : 'var(--yellow)' }}>
              {lastOffer ? `${lastOffer.price} HBAR` : '—'}
            </div>
            <div className="neg-price-sub">{t('currentOffer')}</div>
          </div>
        </div>
      </div>

      <div className="meter-bar">
        <div className="meter-top">
          <div className="meter-label">{t('sellProbability')}</div>
          <div className="meter-pct" style={{ color: prob != null ? meterColor(prob) : 'var(--muted)' }}>
            {evaluating ? t('evaluating') : prob != null ? `${prob}%` : t('waiting')}
          </div>
        </div>
        <div className="meter-track">
          <div
            className="meter-fill"
            style={{ width: `${prob ?? 0}%`, background: prob != null ? meterColor(prob) : 'var(--muted)' }}
          />
        </div>
        <div className="meter-hints">
          <span>{t('wontSell')}</span>
          <span>{t('willSell')}</span>
        </div>
      </div>

      <div className="chat-area" ref={chatRef}>
        {messages.map((m, i) => {
          if (m.kind === 'offer') {
            const isAgent = String(m.buyer ?? '').startsWith('agent:');
            return (
              <div className={`cmsg right ${isAgent ? 'buyer-agent-msg' : 'human-msg'}`} key={i}>
                <div className={`cmsg-av ${isAgent ? 'buyer-agent' : 'human'}`}>{isAgent ? 'BA' : 'YOU'}</div>
                <div className="cmsg-body">
                  <div className="cmsg-bubble">
                    {m.price} HBAR — “{m.argument}”
                  </div>
                  <div className="cmsg-meta">
                    {isAgent ? `${t('buyerAgent')} · ${m.buyer.slice(6)}` : buyerLabel ?? t('judge')} · {time(m.consensusAt)} · seq {m.sequence}
                  </div>
                </div>
              </div>
            );
          }
          if (m.kind === 'reasoning')
            return (
              <div className="cmsg left" key={i}>
                <div className="cmsg-av system">⬡</div>
                <div className="cmsg-body" style={{ maxWidth: '100%' }}>
                  <div className="system-bubble">{m.reasoning}</div>
                  <div className="cmsg-meta">
                    HCS-10 · seq {m.sequence} · p={m.sellProbability}%
                  </div>
                </div>
              </div>
            );
          return (
            <div className="cmsg left" key={i}>
              <div className="cmsg-av seller">CA</div>
              <div className="cmsg-body">
                <div className="cmsg-bubble">{m.spokenVerdict}</div>
                <div className="cmsg-meta">
                  {t('sellerAgent')} · {time(m.consensusAt)} · seq {m.sequence}
                </div>
              </div>
            </div>
          );
        })}
        {pending && (
          <div className="cmsg right human-msg">
            <div className="cmsg-av human">YOU</div>
            <div className="cmsg-body">
              <div className="cmsg-bubble" style={{ opacity: 0.7 }}>
                {pending.price} HBAR — “{pending.argument}”
              </div>
              <div className="cmsg-meta">
                ⏳ {i18n.language === 'es' ? 'registrando en Hedera…' : 'recording on Hedera…'}
              </div>
            </div>
          </div>
        )}
        {evaluating && (
          <div className="typing-row">
            <div className="cmsg-av seller">CA</div>
            <div className="t-dots"><div className="t-dot" /><div className="t-dot" /><div className="t-dot" /></div>
            <div className="t-label">Kickoff Seller Agent…</div>
          </div>
        )}
      </div>

      {verdict && (
        <div className="verdict">
          <div className="verdict-icon">
            {verdict.decision === 'accept' ? '☕' : verdict.decision === 'counter' ? '🔁' : '🚫'}
          </div>
          <div
            className="verdict-title"
            style={{ color: verdict.decision === 'accept' ? 'var(--accent)' : verdict.decision === 'counter' ? 'var(--yellow)' : 'var(--red)' }}
          >
            {verdict.decision === 'accept'
              ? `${t('verdictAccept')} — ${lastOffer?.price} HBAR`
              : verdict.decision === 'counter'
              ? `${t('verdictCounter')}: ${verdict.counterPrice} HBAR`
              : t('verdictReject')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              className="verdict-tx"
              href={`https://hashscan.io/testnet/topic/0.0.9217269`}
              target="_blank"
              rel="noreferrer"
            >
              {t('viewOnHashscan')}
            </a>
            {(soundBlocked || verdict.audio) && (
              <button className="verdict-tx" style={{ cursor: 'pointer', background: 'transparent' }} onClick={enableSound}>
                🔊
              </button>
            )}
          </div>
        </div>
      )}

      {n?.reveal && (
        <div className="reveal-sec">
          <div className="reveal-hdr">{t('minRevealed')}</div>
          <div className="reveal-grid">
            <div className="reveal-item">
              <div className="reveal-val" style={{ color: 'var(--muted)' }}>{n.reveal.minPrice} HBAR</div>
              <div className="reveal-lbl">{t('minPrice')}</div>
            </div>
            <div className="reveal-item">
              <div className="reveal-val" style={{ color: 'var(--accent)' }}>{n.reveal.acceptedPrice} HBAR</div>
              <div className="reveal-lbl">{t('offerAccepted')}</div>
            </div>
            <div className="reveal-item">
              <div className={`reveal-val ${n.reveal.acceptedPrice - n.reveal.minPrice >= 0 ? 'spread-pos' : 'spread-neg'}`}>
                {n.reveal.acceptedPrice - n.reveal.minPrice >= 0 ? '+' : ''}
                {n.reveal.acceptedPrice - n.reveal.minPrice} HBAR
              </div>
              <div className="reveal-lbl">{t('spread')}</div>
            </div>
          </div>
        </div>
      )}

      {inputEnabled && !verdict && (
        <div className="offer-input">
          <div className="input-row">
            <div className="amt-wrap">
              <input
                type="number"
                inputMode="decimal"
                min="1"
                step="1"
                placeholder="···"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <span>HBAR</span>
            </div>
            <textarea
              className="arg-input"
              rows={compact ? 2 : 1}
              placeholder={t('offerPlaceholder')}
              value={argument}
              onChange={(e) => setArgument(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          <div className="input-footer">
            <div className="input-hint" style={error ? { color: 'var(--red)' } : undefined}>
              {error ?? (pending ? '⏳ HCS-10…' : t('offerHint'))}
            </div>
            <button
              className="submit-btn"
              style={{ touchAction: 'manipulation', minHeight: 40, minWidth: 110 }}
              disabled={sending || evaluating || !!pending}
              onClick={submit}
            >
              {sending || pending ? '⏳…' : t('send')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
