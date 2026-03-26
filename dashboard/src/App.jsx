import { useState, useEffect } from 'react';
import Header from './components/Header';
import StatsGrid from './components/StatsGrid';
import DonutChart from './components/DonutChart';
import AISummary from './components/AISummary';
import FailedTests from './components/FailedTests';
import AllTests from './components/AllTests';
import embeddedData from '../public/test-run-data.json';

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Used embedded JSON import (works for both dev and build file:// usage)
    if (embeddedData && embeddedData.timestamp) {
      setData(embeddedData);
    } else {
      // Fallback: try fetching in case the import is empty... (i.e.. if the file is missing or not properly generated)
      fetch('./test-run-data.json')
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load test data (${res.status})`);
          return res.json();
        })
        .then(setData)
        .catch((err) => setError(err.message));
    }
  }, []);

  if (error) {
    return (
      <div className="error-screen">
        <div className="error-icon">!</div>
        <p>
          Could not load test run data. Run your tests first mate so that{' '}
          <code>test-run-data.json</code> is generated, then rebuild the dashboard.
        </p>
        <p style={{ fontSize: 12, opacity: 0.6 }}>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading test results...</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <Header data={data} />
      <StatsGrid stats={data.stats} />
      <div className="main-row">
        <DonutChart stats={data.stats} />
        <AISummary summary={data.aiSummary} />
      </div>
      <FailedTests tests={data.failedTests} />
      <AllTests results={data.testResults} />
      <footer className="footer">
        AI Healing Engine &middot; AI-powered test analysis
      </footer>
    </div>
  );
}
