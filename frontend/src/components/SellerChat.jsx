// Live chat with the seller agent — the buyer talks (free text), the agent replies
// in character (LLM via /api/chat), haggling without revealing its floor. This is
// the off-chain negotiation layer; the binding offer still goes on-chain.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function SellerChat({ productName }) {
  const { i18n } = useTranslation();
  const es = i18n.language === 'es';
  const [messages, setMessages] = useState([]); // { role: 'buyer' | 'agent', text }
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: 'buyer', text }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages, productName }),
      });
      const data = await res.json();
      setMessages([...next, { role: 'agent', text: data.reply || '…' }]);
    } catch {
      setMessages([...next, { role: 'agent', text: es ? '(sin conexión)' : '(offline)' }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="seller-chat">
      <div className="sc-head">💬 {es ? 'Chatea con el agente vendedor' : 'Chat with the seller agent'}</div>
      <div className="sc-body" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="sc-empty">
            {es
              ? 'Salúdalo, pregunta, regatea. Tu historia puede ganarle al dinero.'
              : 'Say hi, ask questions, haggle. Your story can beat the money.'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`sc-msg ${m.role}`}>
            {m.role === 'agent' && <span className="sc-av">CA</span>}
            <div className="sc-bubble">{m.text}</div>
          </div>
        ))}
        {sending && (
          <div className="sc-msg agent">
            <span className="sc-av">CA</span>
            <div className="sc-bubble sc-typing"><span /><span /><span /></div>
          </div>
        )}
      </div>
      <div className="sc-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={es ? 'Escribe al agente…' : 'Message the agent…'}
        />
        <button onClick={send} disabled={sending || !input.trim()}>{sending ? '…' : '➤'}</button>
      </div>
    </div>
  );
}
