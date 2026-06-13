// Studio "behind the scenes" console — a docked log that streams the ACTUAL
// outputs of a running flow, so activation shows real data (offer text, agent
// reasoning, verdict, reveal) instead of only node colors. Fed pre-formatted
// lines by Studio: real WS events in live mode, simulation steps in sim mode.
import { useEffect, useRef } from 'react';

export default function StudioConsole({ open, lines, title, subtitle, emptyLabel, onToggle }) {
  const bodyRef = useRef(null);

  // Auto-scroll to the newest line as the flow advances.
  useEffect(() => {
    if (!open) return;
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length, open]);

  return (
    <div className={`studio-console ${open ? 'open' : 'collapsed'}`}>
      <button className="console-head" onClick={onToggle} aria-expanded={open}>
        <span className="console-title">
          <span className="console-live-dot" /> {title}
        </span>
        <span className="console-sub">{subtitle}</span>
        <span className="console-chevron">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="console-body" ref={bodyRef}>
          {lines.length === 0 ? (
            <div className="console-empty">{emptyLabel}</div>
          ) : (
            lines.map((line) => (
              <div className="console-line" key={line.id}>
                <span className="console-icon">{line.icon}</span>
                <span className={`console-tag tone-${line.tone}`}>{line.tag}</span>
                <span className="console-copy">
                  {line.text && <span className="console-text">{line.text}</span>}
                  {line.meta && <span className="console-meta">{line.meta}</span>}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
