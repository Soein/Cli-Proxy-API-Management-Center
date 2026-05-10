/**
 * KiroLoginCard renders two login buttons: PKCE (Google/GitHub via browser)
 * and AWS Builder ID device code (with polling). On success, the credential
 * file is persisted server-side and will appear in AuthFilesPage's list on
 * next refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { kiroApi } from '@/services/api/kiro';
import type { KiroDeviceStatusResponse, KiroLoginProvider } from '@/types/kiro';
import styles from './KiroLoginCard.module.scss';

interface KiroLoginCardProps {
  /** Called after a successful login so caller can refresh the auth files list. */
  onSuccess?: () => void;
}

type DeviceState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'polling'; sessionId: string; userCode: string; verificationUri: string }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

type PKCEState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'opened'; authUrl: string }
  | { kind: 'error'; message: string };

const POLL_INTERVAL_MS = 3000;

export function KiroLoginCard({ onSuccess }: KiroLoginCardProps) {
  const { t } = useTranslation();
  const [pkce, setPkce] = useState<PKCEState>({ kind: 'idle' });
  const [device, setDevice] = useState<DeviceState>({ kind: 'idle' });
  const pollTimerRef = useRef<number | null>(null);

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  const handlePKCE = useCallback(
    async (provider: KiroLoginProvider) => {
      setPkce({ kind: 'starting' });
      try {
        const res = await kiroApi.startPKCELogin(provider);
        setPkce({ kind: 'opened', authUrl: res.auth_url });
        window.open(res.auth_url, '_blank', 'noopener,noreferrer');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPkce({ kind: 'error', message });
      }
    },
    [],
  );

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const handleDevice = useCallback(async () => {
    setDevice({ kind: 'starting' });
    try {
      const res = await kiroApi.startDeviceLogin();
      setDevice({
        kind: 'polling',
        sessionId: res.session_id,
        userCode: res.user_code,
        verificationUri: res.verification_uri,
      });

      stopPolling();
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const status: KiroDeviceStatusResponse = await kiroApi.getDeviceStatus(res.session_id);
          if (status.status === 'success') {
            stopPolling();
            setDevice({ kind: 'success' });
            onSuccess?.();
          } else if (status.status === 'error') {
            stopPolling();
            setDevice({ kind: 'error', message: status.error ?? 'unknown' });
          }
        } catch (err) {
          stopPolling();
          setDevice({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDevice({ kind: 'error', message });
    }
  }, [stopPolling, onSuccess]);

  return (
    <div className={styles.card}>
      <h3 className={styles.title}>{t('ai_providers.kiro_title')}</h3>
      <p className={styles.desc}>{t('ai_providers.kiro_desc')}</p>

      {/* PKCE */}
      <div className={styles.section}>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => handlePKCE('google')}
            disabled={pkce.kind === 'starting'}
          >
            {t('ai_providers.kiro_pkce_button_google')}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => handlePKCE('github')}
            disabled={pkce.kind === 'starting'}
          >
            {t('ai_providers.kiro_pkce_button_github')}
          </button>
        </div>
        {pkce.kind === 'starting' && (
          <p className={styles.hint}>{t('ai_providers.kiro_login_starting')}</p>
        )}
        {pkce.kind === 'opened' && (
          <div className={styles.hint}>
            <p>{t('ai_providers.kiro_open_browser_hint')}</p>
            <a href={pkce.authUrl} target="_blank" rel="noreferrer" className={styles.link}>
              {pkce.authUrl}
            </a>
          </div>
        )}
        {pkce.kind === 'error' && (
          <p className={styles.error}>
            {t('ai_providers.kiro_login_error', { error: pkce.message })}
          </p>
        )}
      </div>

      {/* Builder ID device code */}
      <div className={styles.section}>
        <button
          type="button"
          className={styles.btn}
          onClick={handleDevice}
          disabled={device.kind === 'starting' || device.kind === 'polling'}
        >
          {t('ai_providers.kiro_device_button')}
        </button>
        {device.kind === 'starting' && (
          <p className={styles.hint}>{t('ai_providers.kiro_login_starting')}</p>
        )}
        {device.kind === 'polling' && (
          <div className={styles.hint}>
            <p>
              <strong>{t('ai_providers.kiro_device_user_code')}: </strong>
              <code className={styles.code}>{device.userCode}</code>
            </p>
            <p>
              <a
                href={device.verificationUri}
                target="_blank"
                rel="noreferrer"
                className={styles.link}
              >
                {device.verificationUri}
              </a>
            </p>
            <p className={styles.muted}>{t('ai_providers.kiro_device_polling')}</p>
          </div>
        )}
        {device.kind === 'success' && (
          <p className={styles.success}>{t('ai_providers.kiro_login_success')}</p>
        )}
        {device.kind === 'error' && (
          <p className={styles.error}>
            {t('ai_providers.kiro_login_error', { error: device.message })}
          </p>
        )}
      </div>
    </div>
  );
}
