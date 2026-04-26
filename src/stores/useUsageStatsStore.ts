import { create } from 'zustand';
import { usageApi } from '@/services/api';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  collectUsageDetails,
  computeKeyStatsFromDetails,
  type KeyStats,
  type UsageDetail,
} from '@/utils/usage';
import type { ClusterAggregates, UsageEventRow, UsageQueryParams } from '@/types/usage';
import i18n from '@/i18n';

export const USAGE_STATS_STALE_TIME_MS = 240_000;

export type LoadUsageStatsOptions = {
  force?: boolean;
  staleTimeMs?: number;
  range?: UsageQueryParams;
};

type UsageStatsSnapshot = Record<string, unknown>;

type UsageStatsState = {
  usage: UsageStatsSnapshot | null;
  cluster: ClusterAggregates | null;
  details: UsageEventRow[] | null;
  detailsLoading: boolean;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loading: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  scopeKey: string;
  /** Last range key used by loadUsageStats; cache by (scope+range). */
  cacheKey: string;
  loadUsageStats: (options?: LoadUsageStatsOptions) => Promise<void>;
  loadDetailsLazy: (range?: UsageQueryParams) => Promise<void>;
  clearUsageStats: () => void;
};

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });

const computeRangeKey = (range?: UsageQueryParams): string => (range ? JSON.stringify(range) : '');

const computeCacheKey = (scopeKey: string, range?: UsageQueryParams): string =>
  `${scopeKey}::${computeRangeKey(range)}`;

let usageRequestToken = 0;
let inFlightUsageRequest: { id: number; cacheKey: string; promise: Promise<void> } | null = null;
let detailsRequestToken = 0;

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : i18n.t('usage_stats.loading_error');

export const useUsageStatsStore = create<UsageStatsState>((set, get) => ({
  usage: null,
  cluster: null,
  details: null,
  detailsLoading: false,
  keyStats: createEmptyKeyStats(),
  usageDetails: [],
  loading: false,
  error: null,
  lastRefreshedAt: null,
  scopeKey: '',
  cacheKey: '',

  loadUsageStats: async (options = {}) => {
    const force = options.force === true;
    const staleTimeMs = options.staleTimeMs ?? USAGE_STATS_STALE_TIME_MS;
    const range = options.range;
    const { apiBase = '', managementKey = '' } = useAuthStore.getState();
    const scopeKey = `${apiBase}::${managementKey}`;
    const cacheKey = computeCacheKey(scopeKey, range);
    const state = get();
    const scopeChanged = state.scopeKey !== scopeKey;
    const cacheKeyChanged = state.cacheKey !== cacheKey;

    // 同 cacheKey 已在飞，复用同一 Promise（避免 4 个 tab 并发触发 4 次 /usage）。
    if (inFlightUsageRequest && inFlightUsageRequest.cacheKey === cacheKey) {
      await inFlightUsageRequest.promise;
      return;
    }

    // 连接目标变化时（apiBase 或 managementKey 改了），旧请求结果必须失效。
    if (inFlightUsageRequest && inFlightUsageRequest.cacheKey !== cacheKey) {
      usageRequestToken += 1;
      inFlightUsageRequest = null;
    }

    const fresh =
      !scopeChanged &&
      !cacheKeyChanged &&
      state.lastRefreshedAt !== null &&
      Date.now() - state.lastRefreshedAt < staleTimeMs;

    if (!force && fresh) {
      return;
    }

    if (scopeChanged) {
      set({
        usage: null,
        cluster: null,
        details: null,
        keyStats: createEmptyKeyStats(),
        usageDetails: [],
        error: null,
        lastRefreshedAt: null,
        scopeKey,
        cacheKey: '',
      });
    }

    const requestId = (usageRequestToken += 1);
    set({ loading: true, error: null, scopeKey });

    const requestPromise = (async () => {
      try {
        const usageResponse = await usageApi.getUsage(range);
        const rawUsage = (usageResponse?.usage ?? usageResponse) as UsageStatsSnapshot | null;
        const usage =
          rawUsage && typeof rawUsage === 'object' ? (rawUsage as UsageStatsSnapshot) : null;
        const cluster = (usageResponse?.cluster as ClusterAggregates | undefined) ?? null;

        if (requestId !== usageRequestToken) return;

        const usageDetails = collectUsageDetails(usage);
        set({
          usage,
          cluster,
          keyStats: computeKeyStatsFromDetails(usageDetails),
          usageDetails,
          loading: false,
          error: null,
          lastRefreshedAt: Date.now(),
          scopeKey,
          cacheKey,
        });
      } catch (error: unknown) {
        if (requestId !== usageRequestToken) return;
        const message = getErrorMessage(error);
        set({
          loading: false,
          error: message,
          scopeKey,
        });
        throw new Error(message);
      } finally {
        if (inFlightUsageRequest?.id === requestId) {
          inFlightUsageRequest = null;
        }
      }
    })();

    inFlightUsageRequest = { id: requestId, cacheKey, promise: requestPromise };
    await requestPromise;
  },

  loadDetailsLazy: async (range?: UsageQueryParams) => {
    const reqId = (detailsRequestToken += 1);
    set({ detailsLoading: true });
    try {
      const res = await usageApi.getUsageDetails(range);
      if (reqId !== detailsRequestToken) return;
      set({
        details: (res?.details as UsageEventRow[] | undefined) ?? [],
        detailsLoading: false,
      });
    } catch (error: unknown) {
      if (reqId !== detailsRequestToken) return;
      set({
        detailsLoading: false,
        error: getErrorMessage(error),
      });
    }
  },

  clearUsageStats: () => {
    usageRequestToken += 1;
    detailsRequestToken += 1;
    inFlightUsageRequest = null;
    set({
      usage: null,
      cluster: null,
      details: null,
      detailsLoading: false,
      keyStats: createEmptyKeyStats(),
      usageDetails: [],
      loading: false,
      error: null,
      lastRefreshedAt: null,
      scopeKey: '',
      cacheKey: '',
    });
  },
}));
