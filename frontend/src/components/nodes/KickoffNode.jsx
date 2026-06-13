import { Handle, Position } from '@xyflow/react';

export default function KickoffNode({ data, selected }) {
  return (
    <div className={`kn ${data.live ? 'active' : ''}`} style={selected ? { borderColor: data.color } : undefined}>
      <Handle type="target" position={Position.Left} className="kn-handle kn-handle-target" />
      <span className="kn-port kn-port-in">IN</span>
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
      <span className="kn-port kn-port-out">OUT</span>
      <Handle type="source" position={Position.Right} className="kn-handle kn-handle-source" style={{ '--node-color': data.color }} />
    </div>
  );
}
