import { useRef, useMemo, useEffect } from 'react';
import { createWatchMetricsAPI, useMetricsActions, type WatchMetricsAPI } from '../stores/metricsStore';

/**
 * Hook that provides a stable API for recording metrics for a specific watch.
 * This hook does NOT cause re-renders when metrics change.
 * 
 * For reading metrics reactively, use useWatchMetricsState(watchId) from the store.
 */
export function useWatchMetrics(watchId: string): WatchMetricsAPI {
  const renderCountRef = useRef(0);

  // Increment render count on each hook call
  renderCountRef.current++;

  // Register this watch for per-watch mutation timestamp tracking
  useEffect(() => {
    const { registerWatch, unregisterWatch } = useMetricsActions.getState();
    registerWatch(watchId);
    return () => unregisterWatch(watchId);
  }, [watchId]);

  // Create stable API object - only recreated if watchId changes
  const api = useMemo(
    () => createWatchMetricsAPI(watchId, renderCountRef),
    [watchId]
  );

  return api;
}

// Re-export types for convenience
export type { WatchMetricsAPI } from '../stores/metricsStore';
