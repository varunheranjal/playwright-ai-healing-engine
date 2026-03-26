import React from 'react'

export default function FailedTests({ tests }) {
  if (!tests || tests.length === 0) return null;

  return (
    <div className="section-card">
      <h2>Failed Tests ({tests.length})</h2>
      <table className="tests-table">
        <thead>
          <tr>
            <th>Test</th>
            <th>Status</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t, i) => (
            <tr key={i}>
              <td>
                <div className="test-name">{t.title}</div>
                <div className="test-suite">{t.suite}</div>
              </td>
              <td>
                <span className={`status-tag ${t.status === 'timedOut' ? 'timedout' : 'failed'}`}>
                  {t.status === 'timedOut' ? 'Timed Out' : 'Failed'}
                </span>
              </td>
              <td>
                <div className="error-snippet">{t.error}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
