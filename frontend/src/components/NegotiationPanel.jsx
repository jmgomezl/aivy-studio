// The live negotiation surface — shared by the Mini App (Offer page) and Arena.
// Everything rendered here comes from real backend events (HCS-10 via WS).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../lib/asset.js';
import { shippingGuide } from '../lib/shipping.js';

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
  const [agentIdentity, setAgentIdentity] = useState(null);
  const [ens, setEns] = useState(null);

  // The seller agent's ERC-8004 on-chain identity (Trustless Agents registry).
  useEffect(() => {
    fetch('/api/agent-identity').then((r) => r.json()).then((d) => d?.enabled && setAgentIdentity(d)).catch(() => {});
    // Live ENS resolution — the agent's identity card is READ from ENS at runtime.
    fetch('/api/ens/agent').then((r) => r.json()).then((d) => d?.resolved && setEns(d)).catch(() => {});
  }, []);
  const playedRef = useRef(new Set());
  const chatRef = useRef(null);

  const n = negotiation;
  const prob = n?.sellProbability;
  const verdict = n?.verdict;
  const lastOffer = n?.offers?.[n.offers.length - 1];
  const evaluating = n?.status === 'evaluating';
  // Only an accepted deal is terminal. A reject/counter is interim — the
  // negotiation keeps moving (a newer offer landed, the buyer is an autonomous
  // agent that will counter, or we're re-evaluating). Show it as a LIVE, partial
  // round, not a harsh final "rejected".
  const dealClosed = verdict?.decision === 'accept';
  const isAgentBuyer = String(lastOffer?.buyer ?? '').startsWith('agent:');
  const negotiationLive =
    !!verdict && !dealClosed && !n?.reveal &&
    ((lastOffer?.sequence ?? 0) > (verdict?.sequence ?? 0) || isAgentBuyer || n?.status === 'evaluating');

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
    new Audio(assetUrl(v.audio)).play().catch(() => setSoundBlocked(true));
  }, [n?.verdict]); // eslint-disable-line react-hooks/exhaustive-deps

  function enableSound() {
    setSoundBlocked(false);
    const v = n?.verdict;
    if (v?.audio) new Audio(assetUrl(v.audio)).play().catch(() => {});
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
      setError(i18n.language === 'es' ? 'Pon un precio en USD (mín. 1)' : 'Enter a price in USD (min 1)');
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
            {item?.photoUrl ? <img src={assetUrl(item.photoUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '☕'}
          </div>
          <div>
            <div className="neg-item-name">{item?.name || t('coffeeName')}</div>
            <div className="neg-item-sub">Kickoff Seller Agent · 0.0.9217340 · Hedera</div>
            {agentIdentity && (
              <a className="erc8004-badge" href={agentIdentity.explorer} target="_blank" rel="noreferrer" title={`ERC-8004 registry ${agentIdentity.registry}`}>
                🪪 ERC-8004 · agent #{agentIdentity.agentId}{ens?.name ? '' : ` · ${agentIdentity.agentDomain}`}
              </a>
            )}
            {ens?.name && (
              <a className="ens-name-badge" href={ens.app} target="_blank" rel="noreferrer" title="Resolved live from ENS · Sepolia">
                🔗 {ens.name}
              </a>
            )}
          </div>
          <div className="neg-price-area">
            <div className="neg-price-val" style={{ color: prob != null ? meterColor(prob) : 'var(--yellow)' }}>
              {lastOffer ? `${lastOffer.price} USD` : '—'}
            </div>
            <div className="neg-price-sub">{t('currentOffer')}</div>
          </div>
        </div>
      </div>

      {ens?.resolved && (
        <div className="ens-card">
          <div className="ens-card-head">
            <a className="ens-card-name" href={ens.app} target="_blank" rel="noreferrer">🔗 {ens.name}</a>
            <span className="ens-card-live">{i18n.language === 'es' ? 'resuelto en vivo · ENS · Sepolia' : 'resolved live · ENS · Sepolia'}</span>
          </div>
          {ens.address && <div className="ens-card-addr">→ {ens.address.slice(0, 10)}…{ens.address.slice(-6)}</div>}
          {ens.records?.description && <div className="ens-card-desc">{ens.records.description}</div>}
          <div className="ens-card-kv">
            {ens.records?.['agent.role'] && <span>role: <b>{ens.records['agent.role']}</b></span>}
            {ens.records?.['agent.framework'] && <span>framework: <b>{ens.records['agent.framework']}</b></span>}
            {ens.records?.['hedera.account'] && <span>hedera: <b>{ens.records['hedera.account']}</b></span>}
            {ens.records?.['com.github'] && <a href={`https://github.com/${ens.records['com.github']}`} target="_blank" rel="noreferrer">github ↗</a>}
          </div>
        </div>
      )}

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
                    {m.price} USD — “{m.argument}”
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
                {pending.price} USD — “{pending.argument}”
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

      {verdict && dealClosed && (
        <div className="verdict">
          <div className="verdict-icon">🤝</div>
          <div className="verdict-title" style={{ color: 'var(--accent)' }}>
            {t('verdictAccept')} — {lastOffer?.price} USD
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a className="verdict-tx" href={`https://hashscan.io/testnet/topic/0.0.9217269`} target="_blank" rel="noreferrer">
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

      {verdict && !dealClosed && !n?.reveal && (
        <div className={`verdict live ${negotiationLive ? 'pulsing' : ''}`}>
          <div className="verdict-live-head">
            <span className="verdict-live-dot" />
            {negotiationLive ? t('negotiationLivePartial') : t('roundPartial')}
          </div>
          <div className="verdict-title" style={{ color: 'var(--yellow)', fontSize: 16 }}>
            {verdict.decision === 'counter' && verdict.counterPrice
              ? t('agentCountered', { price: verdict.counterPrice })
              : t('agentHoldingOut')}
          </div>
          <div className="verdict-reason">{isAgentBuyer ? t('agentsNegotiating') : t('keepNegotiating')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a className="verdict-tx" href={`https://hashscan.io/testnet/topic/0.0.9217269`} target="_blank" rel="noreferrer">
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

      {n?.settlement && (() => {
        const es = i18n.language === 'es';
        const pending = n.settlement.mode === 'scheduled-pending';
        const sid = n.settlement.scheduleId;
        return (
          <div className={`sched-badge ${pending ? 'sched-wait' : ''}`}>
            <div className="sched-row">
              <span className="sched-title">⏱ {es ? 'Transacción Programada de Hedera' : 'Hedera Scheduled Transaction'}</span>
              <span className={`sched-pill ${pending ? 'sched-pending' : 'sched-done'}`}>
                {pending ? (es ? 'esperando co-firma Ledger' : 'awaiting Ledger co-sign') : (es ? 'auto-ejecutada ✓' : 'auto-executed ✓')}
              </span>
            </div>
            <div className="sched-sub">
              {pending
                ? (es ? 'La liquidación se propuso on-chain como transacción programada y queda pendiente hasta que el hardware wallet del vendedor la co-firme.' : 'Settlement was proposed on-chain as a scheduled transaction and stays pending until the seller’s hardware wallet co-signs it.')
                : (es ? 'La liquidación se propuso on-chain como transacción programada y se ejecutó automáticamente al firmarla el agente.' : 'Settlement was proposed on-chain as a scheduled transaction and executed automatically once the agent signed it.')}
            </div>
            {sid && (
              <a className="sched-tx" href={`https://hashscan.io/testnet/schedule/${sid}`} target="_blank" rel="noreferrer">
                {sid} · {es ? 'ver en Hashscan' : 'verify on Hashscan'} ↗
              </a>
            )}
          </div>
        );
      })()}

      {n?.reveal && (
        <div className="reveal-sec">
          <div className="reveal-hdr">{t('minRevealed')}</div>
          <div className="reveal-grid">
            <div className="reveal-item">
              <div className="reveal-val" style={{ color: 'var(--muted)' }}>{n.reveal.minPrice} USD</div>
              <div className="reveal-lbl">{t('minPrice')}</div>
            </div>
            <div className="reveal-item">
              <div className="reveal-val" style={{ color: 'var(--accent)' }}>{n.reveal.acceptedPrice} USD</div>
              <div className="reveal-lbl">{t('offerAccepted')}</div>
            </div>
            <div className="reveal-item">
              <div className={`reveal-val ${n.reveal.acceptedPrice - n.reveal.minPrice >= 0 ? 'spread-pos' : 'spread-neg'}`}>
                {n.reveal.acceptedPrice - n.reveal.minPrice >= 0 ? '+' : ''}
                {n.reveal.acceptedPrice - n.reveal.minPrice} USD
              </div>
              <div className="reveal-lbl">{t('spread')}</div>
            </div>
          </div>
        </div>
      )}

      {n?.insurance && (
        <div className="ins-badge">
          <span className="ins-title">🛡 {i18n.language === 'es' ? 'Paquete asegurado' : 'Package insured'}</span>
          <span className="ins-meta">
            {n.insurance.premiumHbar} HBAR · {i18n.language === 'es' ? 'cubre' : 'covers'} {n.insurance.coverageHbar} HBAR
          </span>
          {n.insurance.txHash && (
            <a className="ins-tx" href={`https://hashscan.io/testnet/transaction/${n.insurance.txHash}`} target="_blank" rel="noreferrer">
              {i18n.language === 'es' ? 'on-chain ↗' : 'on-chain ↗'}
            </a>
          )}
        </div>
      )}

      {n?.payment && (() => {
        const es = i18n.language === 'es';
        return (
          <div className="pay-badge">
            <span className="pay-title">💵 {es ? 'Pago real liquidado' : 'Real payment settled'}</span>
            <span className="pay-amt">{Number(n.payment.amountUsd).toLocaleString()} KUSD</span>
            <span className="pay-meta">
              {es ? 'financiado por el comprador' : 'buyer-funded'} · {String(n.payment.from)} → {String(n.payment.to)}
              {n.payment.capped ? (es ? ' · limitado al saldo' : ' · capped to balance') : ''}
            </span>
            {n.payment.txId && (
              <a className="pay-tx" href={`https://hashscan.io/testnet/transaction/${encodeURIComponent(n.payment.txId)}`} target="_blank" rel="noreferrer">
                on-chain ↗
              </a>
            )}
          </div>
        );
      })()}

      {n?.ledgerApproval && (() => {
        const es = i18n.language === 'es';
        const la = n.ledgerApproval;
        return (
          <div className="ledgerapp-badge">
            <span className="ledgerapp-title">🔐 {es ? 'Aprobado en Ledger (Clear-Sign)' : 'Ledger-approved · Clear-Signed'}</span>
            <span className="ledgerapp-meta">
              {es ? 'firmado en dispositivo' : 'signed on device'} · {String(la.signer).slice(0, 8)}…{la.amountUsd ? ` · ${la.amountUsd} USD` : ''}
            </span>
            {la.txHash && (
              <a className="ledgerapp-tx" href={`https://hashscan.io/testnet/transaction/${la.txHash}`} target="_blank" rel="noreferrer">on-chain ↗</a>
            )}
          </div>
        );
      })()}

      {(n?.swap || n?.swapStatus) && (() => {
        const es = i18n.language === 'es';
        const done = n?.swap;
        const failed = done && n.swap.status === 'failed';
        const sym = (done && n.swap.tokenOut) || (n?.swapStatus && n.swapStatus.tokenOut) || 'USDC';
        return (
          <div className={`uni-badge ${failed ? 'uni-fail' : ''}`}>
            <span className="uni-title">🦄 {failed ? (es ? 'Conversión Uniswap falló' : 'Uniswap conversion failed') : !done ? (es ? `Convirtiendo a ${sym}…` : `Converting to ${sym}…`) : (es ? 'Pago cross-asset vía Uniswap' : 'Cross-asset payout via Uniswap')}</span>
            <span className="uni-meta">
              {failed
                ? (es ? 'la liquidación en KUSD se mantiene' : 'KUSD settlement stands')
                : (es ? `liquidación cross-asset · ${n?.swap?.tokenIn || 'ETH'} → ${sym}` : `cross-asset settle · ${n?.swap?.tokenIn || 'ETH'} → ${sym}`)}
            </span>
            {done && n.swap.txHash && (
              <a className="uni-tx" href={`https://sepolia.etherscan.io/tx/${n.swap.txHash}`} target="_blank" rel="noreferrer">
                tx ↗
              </a>
            )}
          </div>
        );
      })()}

      {n?.escrow && (() => {
        const es = i18n.language === 'es';
        const label =
          n.escrow.status === 'released' ? (es ? 'Garantía liberada al vendedor' : 'Escrow released to seller')
          : n.escrow.status === 'refunded' ? (es ? 'Garantía reembolsada al comprador' : 'Escrow refunded to buyer')
          : (es ? 'Fondos en garantía' : 'Funds in escrow');
        return (
          <div className="esc-badge">
            <span className="esc-title">🔒 {label}</span>
            <span className="esc-meta">
              {n.escrow.amountHbar} HBAR · {es ? 'on-chain' : 'on-chain'}{n.escrow.custody === 'operator-funded' ? (es ? ' · fondeado por el operador (demo)' : ' · operator-funded (demo)') : ''}
            </span>
            {n.escrow.txHash && (
              <a className="esc-tx" href={`https://hashscan.io/testnet/transaction/${n.escrow.txHash}`} target="_blank" rel="noreferrer">
                on-chain ↗
              </a>
            )}
          </div>
        );
      })()}

      {n?.reveal && (() => {
        const g = shippingGuide({
          negotiationId: n.negotiationId,
          buyer: lastOffer?.buyer,
          itemName: item?.name,
          price: n.reveal.acceptedPrice,
        });
        return (
          <div className="ship-label">
            <div className="ship-head">
              <span>📦 {t('orderSealed')}</span>
              <strong>{g.order}</strong>
            </div>
            <div className="ship-shipto">
              <div className="ship-lbl">{t('shipTo')}</div>
              <div className="ship-name">{g.name}{g.handle ? <em> · {g.handle}</em> : null}</div>
              <div className="ship-addr">{g.street}<br />{g.city}</div>
            </div>
            <div className="ship-grid">
              <div><span>{t('tracking')}</span><strong>{g.tracking}</strong></div>
              <div><span>{t('carrier')}</span><strong>{g.carrier}</strong></div>
              <div><span>{t('eta')}</span><strong>{g.eta}</strong></div>
            </div>
            <div className="ship-note">{t('shipNote')}</div>
          </div>
        );
      })()}

      {inputEnabled && !dealClosed && (
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
              <span>USD</span>
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
