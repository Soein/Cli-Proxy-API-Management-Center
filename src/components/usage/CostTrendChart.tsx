import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScriptableContext } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  buildHourlyCostSeries,
  buildDailyCostSeries,
  formatUsd,
  type ModelPrice,
} from '@/utils/usage';
import { buildChartOptions, getHourChartMinWidth } from '@/utils/usage/chartConfig';
import { parseTimestampMs } from '@/utils/timestamp';
import type { ClusterTrendPoint } from '@/types/usage';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

export interface CostTrendChartProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  modelPrices: Record<string, ModelPrice>;
  hourWindowHours?: number;
  /** PG mode: cluster.trend with per-token-type sums.
   *  Cost ≈ Σ over buckets of (input × in_price + output × out_price +
   *  cached × cache_in_price). Without per-(bucket,model) granularity
   *  we use the AVERAGE of all configured model prices as an estimate. */
  serverTrend?: ClusterTrendPoint[];
}

/** Estimate cost from cluster.trend buckets. Uses arithmetic mean of all
 *  configured model prices per token category — less precise than per-
 *  request calculation, but the only signal available without details[]. */
function buildCostSeriesFromServerTrend(
  trend: ClusterTrendPoint[],
  prices: Record<string, ModelPrice>,
  period: 'hour' | 'day'
): { labels: string[]; data: number[]; hasData: boolean } {
  const priceList = Object.values(prices);
  if (priceList.length === 0 || trend.length === 0) {
    return { labels: [], data: [], hasData: false };
  }
  // ModelPrice fields are USD per 1M tokens: prompt/completion/cache.
  const avgPrompt = priceList.reduce((s, p) => s + (p.prompt ?? 0), 0) / priceList.length;
  const avgCompletion = priceList.reduce((s, p) => s + (p.completion ?? 0), 0) / priceList.length;
  const avgCache = priceList.reduce((s, p) => s + (p.cache ?? 0), 0) / priceList.length;

  const labels: string[] = [];
  const data: number[] = [];
  let hasData = false;
  trend.forEach((p) => {
    const ts = parseTimestampMs(p.bucket);
    if (!Number.isFinite(ts) || ts <= 0) return;
    const d = new Date(ts);
    const hh = d.getHours().toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    labels.push(period === 'hour' ? `${mm}/${dd} ${hh}:00` : `${mm}/${dd}`);

    const inT = Number(p.input_tokens) || 0;
    const outT = Number(p.output_tokens) || 0;
    const cachedT = Number(p.cached_tokens) || 0;
    // prompt covers non-cached input tokens; cache rate covers the cached
    // portion (usually ~10-25% of input price). When cache price is 0
    // (unset), fall back to input price as a conservative upper bound.
    const cachePrice = avgCache > 0 ? avgCache : avgPrompt;
    const cost =
      (Math.max(inT - cachedT, 0) * avgPrompt + outT * avgCompletion + cachedT * cachePrice) /
      1_000_000;
    data.push(cost);
    if (cost > 0) hasData = true;
  });
  return { labels, data, hasData };
}

const COST_COLOR = '#f59e0b';
const COST_BG = 'rgba(245, 158, 11, 0.15)';

function buildGradient(ctx: ScriptableContext<'line'>) {
  const chart = ctx.chart;
  const area = chart.chartArea;
  if (!area) return COST_BG;
  const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, 'rgba(245, 158, 11, 0.28)');
  gradient.addColorStop(0.6, 'rgba(245, 158, 11, 0.12)');
  gradient.addColorStop(1, 'rgba(245, 158, 11, 0.02)');
  return gradient;
}

export function CostTrendChart({
  usage,
  loading,
  isDark,
  isMobile,
  modelPrices,
  hourWindowHours,
  serverTrend,
}: CostTrendChartProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'hour' | 'day'>('hour');
  const hasPrices = Object.keys(modelPrices).length > 0;
  const hasServerTrend = Array.isArray(serverTrend) && serverTrend.length > 0;

  const { chartData, chartOptions, hasData } = useMemo(() => {
    if (!hasPrices || (!usage && !hasServerTrend)) {
      return { chartData: { labels: [], datasets: [] }, chartOptions: {}, hasData: false };
    }

    const series = hasServerTrend
      ? buildCostSeriesFromServerTrend(serverTrend!, modelPrices, period)
      : period === 'hour'
        ? buildHourlyCostSeries(usage, modelPrices, hourWindowHours)
        : buildDailyCostSeries(usage, modelPrices);

    const data = {
      labels: series.labels,
      datasets: [
        {
          label: t('usage_stats.total_cost'),
          data: series.data,
          borderColor: COST_COLOR,
          backgroundColor: buildGradient,
          pointBackgroundColor: COST_COLOR,
          pointBorderColor: COST_COLOR,
          fill: true,
          tension: 0.35,
        },
      ],
    };

    const baseOptions = buildChartOptions({ period, labels: series.labels, isDark, isMobile });
    const options = {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          ticks: {
            ...(baseOptions.scales?.y && 'ticks' in baseOptions.scales.y
              ? baseOptions.scales.y.ticks
              : {}),
            callback: (value: string | number) => formatUsd(Number(value)),
          },
        },
      },
    };

    return { chartData: data, chartOptions: options, hasData: series.hasData };
  }, [
    usage,
    period,
    isDark,
    isMobile,
    modelPrices,
    hasPrices,
    hourWindowHours,
    t,
    serverTrend,
    hasServerTrend,
  ]);

  return (
    <Card
      title={t('usage_stats.cost_trend')}
      extra={
        <div className={styles.periodButtons}>
          <Button
            variant={period === 'hour' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('hour')}
          >
            {t('usage_stats.by_hour')}
          </Button>
          <Button
            variant={period === 'day' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('day')}
          >
            {t('usage_stats.by_day')}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : !hasPrices ? (
        <div className={styles.hint}>{t('usage_stats.cost_need_price')}</div>
      ) : !hasData ? (
        <div className={styles.hint}>{t('usage_stats.cost_no_data')}</div>
      ) : (
        <div className={styles.chartWrapper}>
          <div className={styles.chartArea}>
            <div className={styles.chartScroller}>
              <div
                className={styles.chartCanvas}
                style={
                  period === 'hour'
                    ? { minWidth: getHourChartMinWidth(chartData.labels.length, isMobile) }
                    : undefined
                }
              >
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
