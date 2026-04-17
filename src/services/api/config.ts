/**
 * 配置相关 API
 */

import { apiClient } from './client';
import type { CodexHourlyAutomationStatus, CodexWeeklyAutomationStatus, Config } from '@/types';
import { normalizeConfigResponse } from './transformers';

// parseAutomationStatus 归一化后端 weekly/hourly automation status 响应,
// 兼容 snake_case 与 camelCase 两种字段命名。
function parseAutomationStatus(
  raw: Record<string, unknown> | null | undefined
): CodexWeeklyAutomationStatus {
  const lastCheckedAtRaw = raw?.['last_checked_at'] ?? raw?.lastCheckedAt;
  const autoDisabledCountRaw = raw?.['auto_disabled_count'] ?? raw?.autoDisabledCount;

  let autoDisabledCount = 0;
  if (typeof autoDisabledCountRaw === 'number' && Number.isFinite(autoDisabledCountRaw)) {
    autoDisabledCount = autoDisabledCountRaw;
  } else if (typeof autoDisabledCountRaw === 'string' && autoDisabledCountRaw.trim() !== '') {
    const parsed = Number(autoDisabledCountRaw);
    if (Number.isFinite(parsed)) {
      autoDisabledCount = parsed;
    }
  }

  return {
    enabled: Boolean(raw?.enabled),
    running: Boolean(raw?.running),
    lastCheckedAt:
      typeof lastCheckedAtRaw === 'string' && lastCheckedAtRaw.trim() !== ''
        ? lastCheckedAtRaw
        : null,
    autoDisabledCount,
  };
}

export const configApi = {
  /**
   * 获取配置（会进行字段规范化）
   */
  async getConfig(): Promise<Config> {
    const raw = await apiClient.get('/config');
    return normalizeConfigResponse(raw);
  },

  /**
   * 获取原始配置（不做转换）
   */
  getRawConfig: () => apiClient.get('/config'),

  /**
   * 更新 Debug 模式
   */
  updateDebug: (enabled: boolean) => apiClient.put('/debug', { value: enabled }),

  /**
   * 更新代理 URL
   */
  updateProxyUrl: (proxyUrl: string) => apiClient.put('/proxy-url', { value: proxyUrl }),

  /**
   * 清除代理 URL
   */
  clearProxyUrl: () => apiClient.delete('/proxy-url'),

  /**
   * 更新重试次数
   */
  updateRequestRetry: (retryCount: number) =>
    apiClient.put('/request-retry', { value: retryCount }),

  /**
   * 配额回退：切换项目
   */
  updateSwitchProject: (enabled: boolean) =>
    apiClient.put('/quota-exceeded/switch-project', { value: enabled }),

  /**
   * 配额回退：切换预览模型
   */
  updateSwitchPreviewModel: (enabled: boolean) =>
    apiClient.put('/quota-exceeded/switch-preview-model', { value: enabled }),

  /**
   * Codex 周限自动检测开关
   */
  updateCodexWeeklyAutomationEnabled: (enabled: boolean) =>
    apiClient.put('/codex-weekly-automation/enabled', { value: enabled }),

  /**
   * Codex 周限自动检测间隔
   */
  updateCodexWeeklyAutomationIntervalSeconds: (value: number) =>
    apiClient.put('/codex-weekly-automation/interval-seconds', { value }),

  /**
   * 获取 Codex 周限自动检测状态
   */
  async getCodexWeeklyAutomationStatus(): Promise<CodexWeeklyAutomationStatus> {
    const raw = await apiClient.get<Record<string, unknown>>('/codex-weekly-automation/status');
    return parseAutomationStatus(raw);
  },

  /**
   * Codex 5h 自动检测开关
   */
  updateCodexHourlyAutomationEnabled: (enabled: boolean) =>
    apiClient.put('/codex-hourly-automation/enabled', { value: enabled }),

  /**
   * Codex 5h 自动检测间隔
   */
  updateCodexHourlyAutomationIntervalSeconds: (value: number) =>
    apiClient.put('/codex-hourly-automation/interval-seconds', { value }),

  /**
   * 获取 Codex 5h 自动检测状态
   */
  async getCodexHourlyAutomationStatus(): Promise<CodexHourlyAutomationStatus> {
    const raw = await apiClient.get<Record<string, unknown>>('/codex-hourly-automation/status');
    return parseAutomationStatus(raw);
  },

  /**
   * 使用统计开关
   */
  updateUsageStatistics: (enabled: boolean) =>
    apiClient.put('/usage-statistics-enabled', { value: enabled }),

  /**
   * 请求日志开关
   */
  updateRequestLog: (enabled: boolean) => apiClient.put('/request-log', { value: enabled }),

  /**
   * 写日志到文件开关
   */
  updateLoggingToFile: (enabled: boolean) => apiClient.put('/logging-to-file', { value: enabled }),

  /**
   * 获取日志总大小上限（MB）
   */
  async getLogsMaxTotalSizeMb(): Promise<number> {
    const data = await apiClient.get<Record<string, unknown>>('/logs-max-total-size-mb');
    const value = data?.['logs-max-total-size-mb'] ?? data?.logsMaxTotalSizeMb ?? 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  },

  /**
   * 更新日志总大小上限（MB）
   */
  updateLogsMaxTotalSizeMb: (value: number) => apiClient.put('/logs-max-total-size-mb', { value }),

  /**
   * WebSocket 鉴权开关
   */
  updateWsAuth: (enabled: boolean) => apiClient.put('/ws-auth', { value: enabled }),

  /**
   * 获取强制模型前缀开关
   */
  async getForceModelPrefix(): Promise<boolean> {
    const data = await apiClient.get<Record<string, unknown>>('/force-model-prefix');
    return Boolean(data?.['force-model-prefix'] ?? data?.forceModelPrefix ?? false);
  },

  /**
   * 更新强制模型前缀开关
   */
  updateForceModelPrefix: (enabled: boolean) =>
    apiClient.put('/force-model-prefix', { value: enabled }),

  /**
   * 获取路由策略
   */
  async getRoutingStrategy(): Promise<string> {
    const data = await apiClient.get<Record<string, unknown>>('/routing/strategy');
    const strategy = data?.strategy ?? data?.['routing-strategy'] ?? data?.routingStrategy;
    return typeof strategy === 'string' ? strategy : 'round-robin';
  },

  /**
   * 更新路由策略
   */
  updateRoutingStrategy: (strategy: string) =>
    apiClient.put('/routing/strategy', { value: strategy }),
};
