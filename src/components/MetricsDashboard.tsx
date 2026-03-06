import { useGlobalTotals, useMetricsActions } from '../stores/metricsStore';

export function MetricsDashboard() {
  const { totalWrites, totalQueries, activeWatches } = useGlobalTotals();
  const { resetAllMetrics } = useMetricsActions();

  return (
    <div style={{
      padding: '8px 12px',
      backgroundColor: '#1e1e1e',
      borderRadius: '4px',
      marginBottom: '8px',
      border: '1px solid #444',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{
        display: 'flex',
        gap: '20px',
        alignItems: 'center',
      }}>
        <h2 style={{ margin: 0, fontSize: '12px', color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Metrics</h2>
        <MetricCard
          label="Total Writes"
          value={totalWrites}
        />
        <MetricCard
          label="Total Queries"
          value={totalQueries}
        />
        <MetricCard
          label="Active Watches"
          value={activeWatches}
        />
      </div>
      <button
        onClick={resetAllMetrics}
        style={{
          padding: '4px 8px',
          fontSize: '12px',
          cursor: 'pointer',
          backgroundColor: '#2a2a2a',
          border: '1px solid #555',
          borderRadius: '3px',
        }}
      >
        Reset
      </button>
    </div>
  );
}

function MetricCard({ label, value }: {
  label: string;
  value: number | string;
}) {
  return (
    <div style={{
      display: 'flex',
      gap: '6px',
      alignItems: 'baseline',
    }}>
      <div style={{
        fontSize: '11px',
        color: '#bbb',
      }}>
        {label}:
      </div>
      <div style={{
        fontSize: '16px',
        fontWeight: 'bold',
        color: 'rgba(255, 255, 255, 0.87)',
      }}>
        {value}
      </div>
    </div>
  );
}
