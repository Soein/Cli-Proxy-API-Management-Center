/**
 * 使用统计相关 API
 *
 * getUsage(params) — 接受时间范围参数（PG 后端会按范围聚合，
 * memory/dual 后端忽略参数返回完整内存快照）。
 * getUsageDetails — 显式拉取明细数组（include=details），让
 * RequestEventsDetailsCard 懒加载，避免默认请求被明细撑大。
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats } from '@/utils/usage';
import type { UsageQueryParams, UsageResponse } from '@/types/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

export interface UsageExportPayload {
  version?: number;
  exported_at?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsageImportResponse {
  added?: number;
  skipped?: number;
  total_requests?: number;
  failed_requests?: number;
  [key: string]: unknown;
}

export const usageApi = {
  /**
   * 获取使用统计。可传 from/to/granularity；后端 backend=pg 时按范围
   * 聚合返回 cluster 段，memory/dual 时忽略参数返回单节点快照。
   */
  getUsage: (params?: UsageQueryParams) =>
    apiClient.get<UsageResponse>('/usage', { params, timeout: USAGE_TIMEOUT_MS }),

  /**
   * 拉取明细数组（include=details）。RequestEventsDetailsCard 在挂载
   * 时懒加载，避免 /usage 默认请求被几千条 detail 撑大。
   */
  getUsageDetails: (params?: Omit<UsageQueryParams, 'include'>) =>
    apiClient.get<UsageResponse>('/usage', {
      params: { ...(params ?? {}), include: 'details' },
      timeout: USAGE_TIMEOUT_MS,
    }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () =>
    apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      const response = await apiClient.get<UsageResponse>('/usage', { timeout: USAGE_TIMEOUT_MS });
      payload = response?.usage ?? response;
    }
    return computeKeyStats(payload);
  },
};
