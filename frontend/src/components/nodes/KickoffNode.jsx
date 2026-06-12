import { Handle, Position } from '@xyflow/react';

export default function KickoffNode({ data, selected }) {
  return (
    <div className={`kn ${data.live ? 'active' : ''}`} style={selected ? { borderColor: data.color } : undefined}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--muted)' }} />
      <div className="kn-head">
        <div className="kn-icon" style={{ background: `color-mix(in srgb, ${data.color} 14%, transparent)` }}>
          {data.icon}
        </div>
        <div>
          <div className="kn-title">{data.title}</div>
          <div className="kn-sub">{data.sub}</div>
        </div>
        <div className="kn-badge" style={{ background: data.live ? 'var(--accent)' : 'var(--muted)' }} />
      </div>
      <div className="kn-detail">{data.detail}</div>
      <Handle type="source" position={Position.Right} style={{ background: data.color }} />
    </div>
  );
}
