import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  buildHourlyTokenBreakdown,
  buildDailyTokenBreakdown,
  type TokenCategory,
  type TokenBreakdownSeries,
} from '@/utils/usage';
import { buildChartOptions, getHourChartMinWidth } from '@/utils/usage/chartConfig';
import { parseTimestampMs } from '@/utils/timestamp';
import type { ClusterTrendPoint } from '@/types/usage';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

const TOKEN_COLORS: Record<TokenCategory, { border: string; bg: string }> = {
  input: { border: '#8b8680', bg: 'rgba(139, 134, 128, 0.25)' },
  output: { border: '#22c55e', bg: 'rgba(34, 197, 94, 0.25)' },
  cached: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.25)' },
  reasoning: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.25)' },
};

const CATEGORIES: TokenCategory[] = ['input', 'output', 'cached', 'reasoning'];

/** Convert backend cluster.trend (already per-bucket aggregated cluster-wide)
 *  to the TokenBreakdownSeries shape this component expects.
 *  Bucket label format follows period (hour/day). When backend doesn't yet
 *  expose the per-type fields (legacy), we fall back to attributing all
 *  tokens to "input" rather than dropping them — better than empty chart. */
function buildSeriesFromServerTrend(
  trend: ClusterTrendPoint[],
  period: 'hour' | 'day'
): TokenBreakdownSeries {
  const labels: string[] = [];
  const dataByCategory: Record<TokenCategory, number[]> = {
    input: [],
    output: [],
    cached: [],
    reasoning: [],
  };
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
    const reasoningT = Number(p.reasoning_tokens) || 0;
    const fallbackToTotal = inT + outT + cachedT + reasoningT === 0 && p.tokens > 0;

    dataByCategory.input.push(fallbackToTotal ? p.tokens : inT);
    dataByCategory.output.push(fallbackToTotal ? 0 : outT);
    dataByCategory.cached.push(fallbackToTotal ? 0 : cachedT);
    dataByCategory.reasoning.push(fallbackToTotal ? 0 : reasoningT);
    if (inT + outT + cachedT + reasoningT + p.tokens > 0) hasData = true;
  });
  return { labels, dataByCategory, hasData };
}

export interface TokenBreakdownChartProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  hourWindowHours?: number;
  /** PG mode: when present, build the 4-category stacked series from
   *  cluster.trend's per-token-type sums (input/output/cached/reasoning).
   *  In PG payload usage.apis[].models[].details[] is empty by default
   *  so the legacy buildHourlyTokenBreakdown returns no data. */
  serverTrend?: ClusterTrendPoint[];
}

export function TokenBreakdownChart({
  usage,
  loading,
  isDark,
  isMobile,
  hourWindowHours,
  serverTrend,
}: TokenBreakdownChartProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'hour' | 'day'>('hour');

  const { chartData, chartOptions } = useMemo(() => {
    const series: TokenBreakdownSeries =
      Array.isArray(serverTrend) && serverTrend.length > 0
        ? buildSeriesFromServerTrend(serverTrend, period)
        : period === 'hour'
          ? buildHourlyTokenBreakdown(usage, hourWindowHours)
          : buildDailyTokenBreakdown(usage);
    const categoryLabels: Record<TokenCategory, string> = {
      input: t('usage_stats.input_tokens'),
      output: t('usage_stats.output_tokens'),
      cached: t('usage_stats.cached_tokens'),
      reasoning: t('usage_stats.reasoning_tokens'),
    };

    const data = {
      labels: series.labels,
      datasets: CATEGORIES.map((cat) => ({
        label: categoryLabels[cat],
        data: series.dataByCategory[cat],
        borderColor: TOKEN_COLORS[cat].border,
        backgroundColor: TOKEN_COLORS[cat].bg,
        pointBackgroundColor: TOKEN_COLORS[cat].border,
        pointBorderColor: TOKEN_COLORS[cat].border,
        fill: true,
        tension: 0.35,
      })),
    };

    const baseOptions = buildChartOptions({ period, labels: series.labels, isDark, isMobile });
    const options = {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          stacked: true,
        },
        x: {
          ...baseOptions.scales?.x,
          stacked: true,
        },
      },
    };

    return { chartData: data, chartOptions: options };
  }, [usage, period, isDark, isMobile, hourWindowHours, t, serverTrend]);

  return (
    <Card
      title={t('usage_stats.token_breakdown')}
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
      ) : chartData.labels.length > 0 ? (
        <div className={styles.chartWrapper}>
          <div className={styles.chartLegend} aria-label="Chart legend">
            {chartData.datasets.map((dataset, index) => (
              <div
                key={`${dataset.label}-${index}`}
                className={styles.legendItem}
                title={dataset.label}
              >
                <span
                  className={styles.legendDot}
                  style={{ backgroundColor: dataset.borderColor }}
                />
                <span className={styles.legendLabel}>{dataset.label}</span>
              </div>
            ))}
          </div>
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
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
