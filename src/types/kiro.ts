/**
 * Kiro provider login flow types.
 */

export type KiroLoginProvider = 'google' | 'github';

export interface KiroPKCEStartResponse {
  session_id: string;
  auth_url: string;
  state: string;
}

export interface KiroDeviceStartResponse {
  session_id: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
}

export type KiroDeviceStatus = 'pending' | 'success' | 'error';

export interface KiroDeviceStatusResponse {
  status: KiroDeviceStatus;
  user_code: string;
  verification_uri: string;
  error?: string;
  access_token_preview?: string;
}

export interface KiroRefreshResponse {
  status: 'ok';
  expires_at: string;
}
