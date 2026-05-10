/**
 * Kiro provider login + manual refresh API.
 */

import { apiClient } from './client';
import type {
  KiroDeviceStartResponse,
  KiroDeviceStatusResponse,
  KiroLoginProvider,
  KiroPKCEStartResponse,
  KiroRefreshResponse,
} from '@/types/kiro';

export const kiroApi = {
  /** Begin a social PKCE login. Returns auth_url to open in a browser. */
  startPKCELogin: async (
    provider: KiroLoginProvider,
    region?: string,
  ): Promise<KiroPKCEStartResponse> => {
    return apiClient.post<KiroPKCEStartResponse>(
      '/v0/management/auth/kiro/login/pkce/start',
      { provider, region },
    );
  },

  /** Begin a Builder ID device-code login. */
  startDeviceLogin: async (region?: string): Promise<KiroDeviceStartResponse> => {
    return apiClient.post<KiroDeviceStartResponse>(
      '/v0/management/auth/kiro/login/device/start',
      { region },
    );
  },

  /** Poll the device-code session status. */
  getDeviceStatus: async (sessionId: string): Promise<KiroDeviceStatusResponse> => {
    return apiClient.get<KiroDeviceStatusResponse>(
      `/v0/management/auth/kiro/login/device/${encodeURIComponent(sessionId)}`,
    );
  },

  /** Manually refresh a Kiro credential file's access token. */
  refresh: async (name: string): Promise<KiroRefreshResponse> => {
    return apiClient.post<KiroRefreshResponse>(
      `/v0/management/auth/kiro/${encodeURIComponent(name)}/refresh`,
    );
  },
};
