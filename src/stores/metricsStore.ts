import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

// Configuration
const MAX_ITEM_RENDER_ENTRIES = 500;
const MAX_LATENCY_MEASUREMENTS = 100;

export interface DiffMetrics {
  added: number;
  removed: number;
  updated: number;
  unchanged: number;
}

export interface WatchMetrics {
  // Query execution
  queryCount: number;
  emissionCount: number;

  // Component rendering
  renderCount: number;
  itemRenderCount: Map<string, number>;
  totalItemRenders: number;

  // Differential-specific
  lastDiff: DiffMetrics | null;

  // Trigger-specific
  triggerFireCount: number;

  // Latency tracking
  latencyMeasurements: number[];
  averageLatency: number | null;
  medianLatency: number | null;
  lowestLatency: number | null;
  lastQueryLatency: number | null;
}

export interface GlobalMetrics {
  totalWrites: number;
  totalQueries: number;
  watchMetrics: Map<string, WatchMetrics>;
}

export const createEmptyWatchMetrics = (): WatchMetrics => ({
  queryCount: 0,
  emissionCount: 0,
  renderCount: 0,
  itemRenderCount: new Map(),
  totalItemRenders: 0,
  lastDiff: null,
  triggerFireCount: 0,
  latencyMeasurements: [],
  averageLatency: null,
  medianLatency: null,
  lowestLatency: null,
  lastQueryLatency: null,
});

// ============================================================================
// Actions Store (stable references, no re-renders when called)
// ============================================================================

interface MetricsActionsState {
  // Private state for mutation timestamp (not reactive)
  _lastMutationTimestamp: number | null;

  // Actions
  incrementWrites: () => void;
  incrementQueries: () => void;
  getWatchMetrics: (watchId: string) => WatchMetrics;
  updateWatchMetrics: (watchId: string, updater: (metrics: WatchMetrics) => WatchMetrics) => void;
  resetAllMetrics: () => void;
  resetWatchMetrics: (watchId: string) => void;
  recordMutationTime: () => void;
  getLastMutationTimestamp: () => number | null;
}

// This store holds actions and the mutation timestamp.
// Components using only actions won't re-render when metrics change.
export const useMetricsActions = create<MetricsActionsState>((set, get) => ({
  _lastMutationTimestamp: null,

  incrementWrites: () => {
    useMetricsState.setState((state) => ({
      totalWrites: state.totalWrites + 1,
    }));
  },

  incrementQueries: () => {
    useMetricsState.setState((state) => ({
      totalQueries: state.totalQueries + 1,
    }));
  },

  getWatchMetrics: (watchId: string): WatchMetrics => {
    return useMetricsState.getState().watchMetrics.get(watchId) ?? createEmptyWatchMetrics();
  },

  updateWatchMetrics: (watchId: string, updater: (metrics: WatchMetrics) => WatchMetrics) => {
    useMetricsState.setState((state) => {
      const newWatchMetrics = new Map(state.watchMetrics);
      const currentMetrics = newWatchMetrics.get(watchId) ?? createEmptyWatchMetrics();
      const updated = updater(currentMetrics);

      // Cap itemRenderCount to prevent memory leaks
      if (updated.itemRenderCount.size > MAX_ITEM_RENDER_ENTRIES) {
        const entries = Array.from(updated.itemRenderCount.entries());
        updated.itemRenderCount = new Map(entries.slice(-MAX_ITEM_RENDER_ENTRIES));
      }

      newWatchMetrics.set(watchId, updated);
      return { watchMetrics: newWatchMetrics };
    });
  },

  resetAllMetrics: () => {
    set({ _lastMutationTimestamp: null });
    useMetricsState.setState({
      totalWrites: 0,
      totalQueries: 0,
      watchMetrics: new Map(),
    });
  },

  resetWatchMetrics: (watchId: string) => {
    useMetricsState.setState((state) => {
      const newWatchMetrics = new Map(state.watchMetrics);
      newWatchMetrics.set(watchId, createEmptyWatchMetrics());
      return { watchMetrics: newWatchMetrics };
    });
  },

  recordMutationTime: () => {
    set({ _lastMutationTimestamp: performance.now() });
  },

  getLastMutationTimestamp: (): number | null => {
    return get()._lastMutationTimestamp;
  },
}));

// ============================================================================
// State Store (reactive, components subscribe to state changes)
// ============================================================================

export const useMetricsState = create<GlobalMetrics>(() => ({
  totalWrites: 0,
  totalQueries: 0,
  watchMetrics: new Map(),
}));

// ============================================================================
// Selectors for fine-grained subscriptions
// ============================================================================

// Stable fallback to avoid creating new object on every render
const EMPTY_WATCH_METRICS = createEmptyWatchMetrics();

/**
 * Subscribe to a specific watch's metrics only.
 * Component will only re-render when that watch's metrics change.
 */
export const useWatchMetricsState = (watchId: string): WatchMetrics => {
  return useMetricsState(
    (state) => state.watchMetrics.get(watchId) ?? EMPTY_WATCH_METRICS
  );
};

/**
 * Subscribe to global totals only (totalWrites, totalQueries, watchMetrics.size).
 */
export const useGlobalTotals = () => {
  return useMetricsState(
    useShallow((state) => ({
      totalWrites: state.totalWrites,
      totalQueries: state.totalQueries,
      activeWatches: state.watchMetrics.size,
    }))
  );
};

// ============================================================================
// Hook for watch metrics API (used by useWatchMetrics hook)
// ============================================================================

export interface WatchMetricsAPI {
  recordQuery: () => void;
  recordEmission: () => void;
  recordRender: () => void;
  recordItemRender: (itemId: string) => void;
  recordDiff: (diff: DiffMetrics) => void;
  recordTriggerFire: () => void;
  recordLatency: () => void;
  reset: () => void;
}

/**
 * Creates a stable API object for recording metrics for a specific watch.
 * This does NOT cause re-renders - it only provides mutation functions.
 */
export function createWatchMetricsAPI(watchId: string, renderCountRef: { current: number }): WatchMetricsAPI {
  const { updateWatchMetrics, resetWatchMetrics, getLastMutationTimestamp } = useMetricsActions.getState();

  return {
    recordQuery: () => {
      updateWatchMetrics(watchId, (metrics) => ({
        ...metrics,
        queryCount: metrics.queryCount + 1,
      }));
    },

    recordEmission: () => {
      updateWatchMetrics(watchId, (metrics) => ({
        ...metrics,
        emissionCount: metrics.emissionCount + 1,
      }));
    },

    recordRender: () => {
      updateWatchMetrics(watchId, (metrics) => ({
        ...metrics,
        renderCount: renderCountRef.current,
      }));
    },

    recordItemRender: (itemId: string) => {
      updateWatchMetrics(watchId, (metrics) => {
        const newItemRenderCount = new Map(metrics.itemRenderCount);
        const currentCount = newItemRenderCount.get(itemId) ?? 0;
        newItemRenderCount.set(itemId, currentCount + 1);
        return {
          ...metrics,
          itemRenderCount: newItemRenderCount,
          totalItemRenders: metrics.totalItemRenders + 1,
        };
      });
    },

    recordDiff: (diff: DiffMetrics) => {
      updateWatchMetrics(watchId, (metrics) => ({
        ...metrics,
        lastDiff: diff,
      }));
    },

    recordTriggerFire: () => {
      updateWatchMetrics(watchId, (metrics) => ({
        ...metrics,
        triggerFireCount: metrics.triggerFireCount + 1,
      }));
    },

    recordLatency: () => {
      const mutationTime = getLastMutationTimestamp();
      if (mutationTime === null) return;

      const latency = performance.now() - mutationTime;

      updateWatchMetrics(watchId, (metrics) => {
        const newMeasurements = [...metrics.latencyMeasurements, latency].slice(-MAX_LATENCY_MEASUREMENTS);
        const averageLatency = newMeasurements.reduce((a, b) => a + b, 0) / newMeasurements.length;
        const lowestLatency = Math.min(...newMeasurements);
        const sorted = [...newMeasurements].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const medianLatency = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];

        return {
          ...metrics,
          latencyMeasurements: newMeasurements,
          averageLatency,
          medianLatency,
          lowestLatency,
          lastQueryLatency: latency,
        };
      });
    },

    reset: () => {
      renderCountRef.current = 0;
      resetWatchMetrics(watchId);
    },
  };
}
