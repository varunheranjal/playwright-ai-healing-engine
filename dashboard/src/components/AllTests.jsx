import React from 'react'

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const secs = (ms / 1000).toFixed(1);
  return `${secs}s`;
}

function outcomeLabel(outcome) {
  switch (outcome) {
    case 'expected': return 'Passed';
    case 'unexpected': return 'Failed';
    case 'flaky': return 'Flaky';
    case 'skipped': return 'Skipped';
    default: return outcome;
  }
}

export default function AllTests({ results }) {
  if (!results || results.length === 0) return null;

  return (
    <div className="section-card">
      <h2>All Tests ({results.length})</h2>
      <table className="results-table">
        <thead>
          <tr>
            <th>Test</th>
            <th>Outcome</th>
            <th>Duration</th>
            <th>Retries</th>
          </tr>
        </thead>
        <tbody>
          {results.map((t, i) => (
            <tr key={i}>
              <td>
                <span className={`outcome-dot ${t.outcome}`} />
                {t.title}
              </td>
              <td>{outcomeLabel(t.outcome)}</td>
              <td className="duration">{formatDuration(t.duration)}</td>
              <td className="duration">{t.retries > 0 ? t.retries : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
