/**
 * 使用统计相关类型
 * 基于原项目 src/modules/usage.js
 */

// 时间段类型
export type TimePeriod = 'hour' | 'day';

// 数据点
export interface DataPoint {
  timestamp: string;
  value: number;
}

// 模型使用统计
export interface ModelUsage {
  modelName: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

// 使用统计数据
export interface UsageStats {
  overview: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
  };
  requestsData: {
    hour: DataPoint[];
    day: DataPoint[];
  };
  tokensData: {
    hour: DataPoint[];
    day: DataPoint[];
  };
  costData: {
    hour: DataPoint[];
    day: DataPoint[];
  };
  modelStats: ModelUsage[];
}

// 模型价格
export interface ModelPrice {
  modelName: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
}

// =============================================================================
// PG-backed cluster usage (后端 backend=pg 时返回)
//
// 后端以 RFC3339 字符串传时间，前端按需 new Date() 解析。所有字段在
// backend != pg 时缺失（响应里没有 cluster 段），前端必须按"未聚合就走旧路径"
// 退化处理。details 仅当 ?include=details 时才存在。
// =============================================================================

export type UsageGranularity = 'hour' | 'day';

export interface UsageQueryParams {
  from?: string; // ISO 8601 / RFC3339
  to?: string;
  granularity?: UsageGranularity;
  include?: 'details' | '';
}

export interface ClusterTrendPoint {
  bucket: string;
  requests: number;
  tokens: number;
  /** Per-token-type breakdown — present in current backend; older PG
   *  backends may omit these. Front-end treats missing as 0. */
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
}

export interface ClusterSparklinePoint {
  bucket: string;
  requests: number;
  tokens: number;
}

export interface ClusterHealthCell {
  hour_start: string;
  request_count: number;
  success_count: number;
  failure_count: number;
}

export interface ClusterApiBreakdownRow {
  api_key: string;
  model: string;
  requests: number;
  tokens: number;
}

export interface ClusterCredentialBreakdownRow {
  source: string;
  auth_index: string;
  requests: number;
  tokens: number;
  success_count: number;
  failure_count: number;
}

export interface ClusterRangeMeta {
  from: string;
  to: string;
  granularity: UsageGranularity;
}

export interface ClusterAggregates {
  aggregated: boolean;
  /** Number of nodes that contributed traffic in the query window. */
  node_count: number;
  /** Number of nodes alive in the cluster (heartbeat fresh). May be 0
   *  on legacy backends that don't expose this — UI should treat 0 as
   *  "unknown" and fall back to plain `node_count` rendering. */
  cluster_node_count?: number;
  range: ClusterRangeMeta;
  trend: ClusterTrendPoint[];
  sparkline: ClusterSparklinePoint[];
  health_grid: ClusterHealthCell[];
  api_breakdown: ClusterApiBreakdownRow[];
  credential_breakdown: ClusterCredentialBreakdownRow[];
  average_latency_ms: number;
}

export interface UsageEventRow {
  occurred_at: string;
  node_id: string;
  api_key: string;
  provider?: string;
  model: string;
  source: string;
  auth_id: string;
  auth_index: string;
  failed: boolean;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  total_tokens: number;
}

// /v0/management/usage 完整响应。usage 是 legacy 兼容字段（PG 模式下后端
// 用 PG 聚合数据重建），cluster 是新加的预聚合块（仅 backend=pg），
// details 仅 include=details 时存在。
export interface UsageResponse {
  usage?: Record<string, unknown>;
  failed_requests?: number;
  cluster?: ClusterAggregates;
  details?: UsageEventRow[];
  [key: string]: unknown;
}
