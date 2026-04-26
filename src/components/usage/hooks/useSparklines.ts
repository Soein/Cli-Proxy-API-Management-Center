import { useCallback, useMemo } from 'react';
import { collectUsageDetails, extractTotalTokens } from '@/utils/usage';
import { parseTimestampMs } from '@/utils/timestamp';
import type { ClusterSparklinePoint } from '@/types/usage';
import type { UsagePayload } from './useUsageData';

export interface SparklineData {
  labels: string[];
  datasets: [
    {
      data: number[];
      borderColor: string;
      backgroundColor: string;
      fill: boolean;
      tension: number;
      pointRadius: number;
      borderWidth: number;
    }
  ];
}

export interface SparklineBundle {
  data: SparklineData;
}

export interface UseSparklinesOptions {
  usage: UsagePayload | null;
  loading: boolean;
  nowMs: number;
  /** PG mode: cluster.sparkline (per-minute aggregates over the last hour).
   *  When present, takes precedence over details[]-derived bucketing —
   *  necessary because PG-mode payload has empty details[] by default
   *  (lazy-loaded), so the legacy path would compute zero. */
  serverSparkline?: ClusterSparklinePoint[];
}

export interface UseSparklinesReturn {
  requestsSparkline: SparklineBundle | null;
  tokensSparkline: SparklineBundle | null;
  rpmSparkline: SparklineBundle | null;
  tpmSparkline: SparklineBundle | null;
  costSparkline: SparklineBundle | null;
}

export function useSparklines({
  usage,
  loading,
  nowMs,
  serverSparkline,
}: UseSparklinesOptions): UseSparklinesReturn {
  const lastHourSeries = useMemo(() => {
    if (!Number.isFinite(nowMs) || nowMs <= 0) {
      return { labels: [], requests: [], tokens: [] };
    }
    const windowMinutes = 60;
    const now = nowMs;
    const windowStart = now - windowMinutes * 60 * 1000;
    const requestBuckets = new Array(windowMinutes).fill(0);
    const tokenBuckets = new Array(windowMinutes).fill(0);

    // PG-mode preferred path: cluster.sparkline carries per-minute
    // bucket aggregates already cluster-summed across all node_id.
    if (Array.isArray(serverSparkline) && serverSparkline.length > 0) {
      serverSparkline.forEach((p) => {
        const ts = parseTimestampMs(p.bucket);
        if (!Number.isFinite(ts) || ts < windowStart || ts > now) return;
        const idx = Math.min(windowMinutes - 1, Math.floor((ts - windowStart) / 60000));
        requestBuckets[idx] += p.requests;
        tokenBuckets[idx] += p.tokens;
      });
    } else if (usage) {
      // Legacy path: derive from details[] (memory/dual mode).
      const details = collectUsageDetails(usage);
      if (!details.length) return { labels: [], requests: [], tokens: [] };
      details.forEach((detail) => {
        const timestamp = detail.__timestampMs ?? 0;
        if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) {
          return;
        }
        const minuteIndex = Math.min(
          windowMinutes - 1,
          Math.floor((timestamp - windowStart) / 60000)
        );
        requestBuckets[minuteIndex] += 1;
        tokenBuckets[minuteIndex] += extractTotalTokens(detail);
      });
    } else {
      return { labels: [], requests: [], tokens: [] };
    }

    const labels = requestBuckets.map((_, idx) => {
      const date = new Date(windowStart + (idx + 1) * 60000);
      const h = date.getHours().toString().padStart(2, '0');
      const m = date.getMinutes().toString().padStart(2, '0');
      return `${h}:${m}`;
    });

    return { labels, requests: requestBuckets, tokens: tokenBuckets };
  }, [nowMs, usage, serverSparkline]);

  const buildSparkline = useCallback(
    (
      series: { labels: string[]; data: number[] },
      color: string,
      backgroundColor: string
    ): SparklineBundle | null => {
      if (loading || !series?.data?.length) {
        return null;
      }
      // Render only when there's actual non-zero data; an all-zero array
      // would draw a flat baseline that looks like a bug.
      const hasAnyValue = series.data.some((v) => v > 0);
      if (!hasAnyValue) return null;
      const sliceStart = Math.max(series.data.length - 60, 0);
      const labels = series.labels.slice(sliceStart);
      const points = series.data.slice(sliceStart);
      return {
        data: {
          labels,
          datasets: [
            {
              data: points,
              borderColor: color,
              backgroundColor,
              fill: true,
              tension: 0.45,
              pointRadius: 0,
              borderWidth: 2,
            },
          ],
        },
      };
    },
    [loading]
  );

  const requestsSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: lastHourSeries.labels, data: lastHourSeries.requests },
        '#8b8680',
        'rgba(139, 134, 128, 0.18)'
      ),
    [buildSparkline, lastHourSeries.labels, lastHourSeries.requests]
  );

  const tokensSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: lastHourSeries.labels, data: lastHourSeries.tokens },
        '#8b5cf6',
        'rgba(139, 92, 246, 0.18)'
      ),
    [buildSparkline, lastHourSeries.labels, lastHourSeries.tokens]
  );

  const rpmSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: lastHourSeries.labels, data: lastHourSeries.requests },
        '#22c55e',
        'rgba(34, 197, 94, 0.18)'
      ),
    [buildSparkline, lastHourSeries.labels, lastHourSeries.requests]
  );

  const tpmSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: lastHourSeries.labels, data: lastHourSeries.tokens },
        '#f97316',
        'rgba(249, 115, 22, 0.18)'
      ),
    [buildSparkline, lastHourSeries.labels, lastHourSeries.tokens]
  );

  const costSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: lastHourSeries.labels, data: lastHourSeries.tokens },
        '#f59e0b',
        'rgba(245, 158, 11, 0.18)'
      ),
    [buildSparkline, lastHourSeries.labels, lastHourSeries.tokens]
  );

  return {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    costSparkline,
  };
}
