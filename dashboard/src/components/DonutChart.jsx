import React from 'react'

export default function DonutChart({ stats }) {
  const { passed, failed, skipped, flaky, passRate } = stats;
  const total = passed + failed + skipped;
  if (total === 0) return null;

  // Build segments: passed (minus flaky), flaky, failed, skipped
  const passedOnly = passed - flaky;
  const segments = [
    { value: passedOnly, color: '#22c55e', label: 'Passed' },
    { value: flaky, color: '#f59e0b', label: 'Flaky' },
    { value: failed, color: '#ef4444', label: 'Failed' },
    { value: skipped, color: '#6b7280', label: 'Skipped' },
  ].filter((s) => s.value > 0);

  // Calculate SVG arcs
  const size = 180;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const arcs = segments.map((seg) => {
    const pct = seg.value / total;
    const dash = pct * circumference;
    const gap = circumference - dash;
    const rotation = offset * 360 - 90; // start at top
    offset += pct;
    return { ...seg, dash, gap, rotation };
  });

  return (
    <div className="chart-card">
      <h2>Distribution</h2>
      <div className="donut-container">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {arcs.map((arc, i) => (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${arc.dash} ${arc.gap}`}
              transform={`rotate(${arc.rotation} ${size / 2} ${size / 2})`}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="donut-center">
          <div className="percent">{passRate}%</div>
          <div className="pass-label">Pass Rate</div>
        </div>
      </div>
      <div className="chart-legend">
        {segments.map((seg) => (
          <div className="legend-item" key={seg.label}>
            <span className="legend-dot" style={{ background: seg.color }} />
            {seg.label} ({seg.value})
          </div>
        ))}
      </div>
    </div>
  );
}
