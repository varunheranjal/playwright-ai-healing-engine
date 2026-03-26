import React from 'react'

export default function Header({ data }) {
  const { timestamp, overallStatus, durationMs, sites } = data;

  const date = new Date(timestamp);
  const formatted = date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const mins = Math.floor(durationMs / 60000);
  const secs = Math.floor((durationMs % 60000) / 1000);
  const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const badgeClass =
    overallStatus === 'passed'
      ? 'passed'
      : overallStatus === 'timedout'
        ? 'timedout'
        : 'failed';

  return (
    <header className="header">
      <div className="header-left">
        <h1>AI Healing Engine — Test Dashboard</h1>
        <p className="subtitle">
          {sites && sites.length > 0 && (
            <>{sites.join(', ')} &middot; </>
          )}
          {formatted} &middot; Duration: {durationStr}
        </p>
      </div>
      <div className={`status-badge ${badgeClass}`}>
        <span className="status-dot" />
        {overallStatus}
      </div>
    </header>
  );
}
