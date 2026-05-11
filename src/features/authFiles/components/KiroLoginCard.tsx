/**
 * KiroLoginCard renders two login buttons: PKCE (Google/GitHub via browser)
 * and AWS Builder ID device code (with polling). On success, the credential
 * file is persisted server-side and will appear in AuthFilesPage's list on
 * next refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
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
  | { kind: 'opened'; authUrl: string; sessionId: string }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

const POLL_INTERVAL_MS = 3000;

export function KiroLoginCard({ onSuccess }: KiroLoginCardProps) {
  const { t } = useTranslation();
  const [pkce, setPkce] = useState<PKCEState>({ kind: 'idle' });
  const [device, setDevice] = useState<DeviceState>({ kind: 'idle' });
  const devicePollRef = useRef<number | null>(null);
  const pkcePollRef = useRef<number | null>(null);

  const stopDevicePolling = useCallback(() => {
    if (devicePollRef.current !== null) {
      window.clearInterval(devicePollRef.current);
      devicePollRef.current = null;
    }
  }, []);

  const stopPKCEPolling = useCallback(() => {
    if (pkcePollRef.current !== null) {
      window.clearInterval(pkcePollRef.current);
      pkcePollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopDevicePolling();
      stopPKCEPolling();
    };
  }, [stopDevicePolling, stopPKCEPolling]);

  const handlePKCE = useCallback(
    async (provider: KiroLoginProvider) => {
      setPkce({ kind: 'starting' });
      try {
        const res = await kiroApi.startPKCELogin(provider);
        setPkce({ kind: 'opened', authUrl: res.auth_url, sessionId: res.session_id });
        window.open(res.auth_url, '_blank', 'noopener,noreferrer');

        stopPKCEPolling();
        pkcePollRef.current = window.setInterval(async () => {
          try {
            const status = await kiroApi.getPKCEStatus(res.session_id);
            if (status.status === 'success') {
              stopPKCEPolling();
              setPkce({ kind: 'success' });
              onSuccess?.();
            } else if (status.status === 'error') {
              stopPKCEPolling();
              setPkce({ kind: 'error', message: status.error ?? 'unknown' });
            }
          } catch (err) {
            stopPKCEPolling();
            setPkce({
              kind: 'error',
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }, POLL_INTERVAL_MS);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPkce({ kind: 'error', message });
      }
    },
    [stopPKCEPolling, onSuccess]
  );

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

      stopDevicePolling();
      devicePollRef.current = window.setInterval(async () => {
        try {
          const status: KiroDeviceStatusResponse = await kiroApi.getDeviceStatus(res.session_id);
          if (status.status === 'success') {
            stopDevicePolling();
            setDevice({ kind: 'success' });
            onSuccess?.();
          } else if (status.status === 'error') {
            stopDevicePolling();
            setDevice({ kind: 'error', message: status.error ?? 'unknown' });
          }
        } catch (err) {
          stopDevicePolling();
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
  }, [stopDevicePolling, onSuccess]);

  return (
    <Card title={t('ai_providers.kiro_title')}>
      <div className={styles.cardContent}>
        <p className={styles.cardHint}>{t('ai_providers.kiro_desc')}</p>

        <div className={styles.section}>
          <div className={styles.buttonRow}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handlePKCE('google')}
              loading={pkce.kind === 'starting'}
            >
              {t('ai_providers.kiro_pkce_button_google')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handlePKCE('github')}
              loading={pkce.kind === 'starting'}
            >
              {t('ai_providers.kiro_pkce_button_github')}
            </Button>
          </div>
          {pkce.kind === 'starting' && (
            <p className={styles.hint}>{t('ai_providers.kiro_login_starting')}</p>
          )}
          {pkce.kind === 'opened' && (
            <div className={styles.authUrlBox}>
              <div className={styles.authUrlLabel}>{t('ai_providers.kiro_open_browser_hint')}</div>
              <div className={styles.authUrlValue}>
                <a href={pkce.authUrl} target="_blank" rel="noreferrer" className={styles.link}>
                  {pkce.authUrl}
                </a>
              </div>
              <p className={styles.muted}>{t('ai_providers.kiro_device_polling')}</p>
            </div>
          )}
          {pkce.kind === 'success' && (
            <div className="status-badge success">{t('ai_providers.kiro_login_success')}</div>
          )}
          {pkce.kind === 'error' && (
            <div className="status-badge error">
              {t('ai_providers.kiro_login_error', { error: pkce.message })}
            </div>
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.buttonRow}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDevice}
              loading={device.kind === 'starting' || device.kind === 'polling'}
            >
              {t('ai_providers.kiro_device_button')}
            </Button>
          </div>
          {device.kind === 'starting' && (
            <p className={styles.hint}>{t('ai_providers.kiro_login_starting')}</p>
          )}
          {device.kind === 'polling' && (
            <div className={styles.authUrlBox}>
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
            <div className="status-badge success">{t('ai_providers.kiro_login_success')}</div>
          )}
          {device.kind === 'error' && (
            <div className="status-badge error">
              {t('ai_providers.kiro_login_error', { error: device.message })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
