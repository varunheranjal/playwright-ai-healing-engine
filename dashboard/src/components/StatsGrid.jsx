import React from 'react'

export default function StatsGrid({ stats }) {
  const cards = [
    { label: 'Total Tests', value: stats.total, color: 'blue' },
    { label: 'Passed', value: stats.passed, color: 'green' },
    { label: 'Failed', value: stats.failed, color: 'red' },
    { label: 'Skipped', value: stats.skipped, color: 'gray' },
    { label: 'Flaky', value: stats.flaky, color: 'yellow' },
    { label: 'Pass Rate', value: `${stats.passRate}%`, color: 'purple' },
  ];

  return (
    <div className="stats-grid">
      {cards.map((card) => (
        <div className="stat-card" key={card.label}>
          <div className="label">{card.label}</div>
          <div className={`value ${card.color}`}>{card.value}</div>
        </div>
      ))}
    </div>
  );
}
