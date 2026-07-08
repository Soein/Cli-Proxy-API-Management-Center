# Kiro Provider — M4 (前端 UI) + M5 (文档 / 配置) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 在 Cli-Proxy-API-Management-Center 添加 Kiro 管理 UI(MVP),并在 CLIProxyAPI 后端仓库补 README/示例配置/简单使用文档。

**Architecture(M4 前端):** 大部分能力 piggy-back 在现有 `AuthFilesPage` — 把 `'kiro'` 加到 `AuthFileType` 枚举后,Kiro 的 oauth_creds.json 上传/列出/删除就**自动可用**。需要新写的只是 PKCE / Builder ID 的**主动登录 UI 组件** + 一组 API client。

**Tech Stack:** React 19、TypeScript、Vite、zustand、i18n(zh-CN.json)、axios。

---

## File Structure

```
# M4 — Cli-Proxy-API-Management-Center
src/types/authFile.ts                    # +'kiro' to AuthFileType
src/types/kiro.ts                        # 新建:KiroDeviceStatus / KiroPKCEStartResponse 等
src/services/api/kiro.ts                 # 新建:4 个 endpoint 包装
src/services/api/index.ts                # 导出 kiroApi
src/features/authFiles/components/KiroLoginCard.tsx  # 新建:PKCE + Device 双 flow UI
src/features/authFiles/components/KiroLoginCard.module.scss
src/i18n/locales/zh-CN.json              # +ai_providers.kiro_* / auth_files.filter_kiro / kiro_*
src/i18n/locales/en-US.json              # 同上(可缺省)
src/pages/AuthFilesPage.tsx              # 在合适位置嵌入 <KiroLoginCard />

# M5 — CLIProxyAPI(在仓库根)
config.example.yaml                      # +kiro: 段 + 注释
README.md                                # +Kiro provider 段落
README_CN.md / README_JA.md              # 同步
docs/kiro.md                             # 新建:详细使用文档(可选)
```

---

## Task 1 (M4): Types + Filter Chip

**Files:**
- Modify: `src/types/authFile.ts`
- Modify: `src/i18n/locales/zh-CN.json`

- [ ] **Step 1: Add 'kiro' to AuthFileType**

Edit `src/types/authFile.ts`. Find the `AuthFileType` union type and add `'kiro'`:

```typescript
export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'gemini-cli'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'iflow'
  | 'vertex'
  | 'kiro'              // ← 新增
  | 'empty'
  | 'unknown';
```

- [ ] **Step 2: Add filter chip i18n**

Edit `src/i18n/locales/zh-CN.json`. Find `auth_files` block and add `filter_kiro`:

```json
"auth_files": {
  "...": "...",
  "filter_kiro": "Kiro"
}
```

(Match indentation of existing `filter_codex`/`filter_claude` etc.)

- [ ] **Step 3: Verify build**

Run: `cd /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center && npm run build 2>&1 | tail -10`
(or `bun run build` if the project uses bun)

Expected: success.

- [ ] **Step 4: Commit**

```bash
git -C /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center add src/types/authFile.ts src/i18n/locales/zh-CN.json
git -C /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center commit -m "feat(types): 添加 'kiro' 到 AuthFileType + i18n 过滤标签"
```

## Context

- After this task, uploading any oauth_creds.json with `"type":"kiro"` will show up in AuthFilesPage with a "Kiro" filter chip.
- **No "Co-Authored-By"** in commits.

---

## Task 2 (M4): API Client

**Files:**
- Create: `src/types/kiro.ts`
- Create: `src/services/api/kiro.ts`
- Modify: `src/services/api/index.ts`

- [ ] **Step 1: Create types**

Create `src/types/kiro.ts`:

```typescript
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
```

- [ ] **Step 2: Create API client**

Create `src/services/api/kiro.ts`:

```typescript
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
    const res = await apiClient.post<KiroPKCEStartResponse>(
      '/v0/management/auth/kiro/login/pkce/start',
      { provider, region },
    );
    return res.data;
  },

  /** Begin a Builder ID device-code login. */
  startDeviceLogin: async (region?: string): Promise<KiroDeviceStartResponse> => {
    const res = await apiClient.post<KiroDeviceStartResponse>(
      '/v0/management/auth/kiro/login/device/start',
      { region },
    );
    return res.data;
  },

  /** Poll the device-code session status. */
  getDeviceStatus: async (sessionId: string): Promise<KiroDeviceStatusResponse> => {
    const res = await apiClient.get<KiroDeviceStatusResponse>(
      `/v0/management/auth/kiro/login/device/${encodeURIComponent(sessionId)}`,
    );
    return res.data;
  },

  /** Manually refresh a Kiro credential file's access token. */
  refresh: async (name: string): Promise<KiroRefreshResponse> => {
    const res = await apiClient.post<KiroRefreshResponse>(
      `/v0/management/auth/kiro/${encodeURIComponent(name)}/refresh`,
    );
    return res.data;
  },
};
```

- [ ] **Step 3: Add to api index**

Edit `src/services/api/index.ts`. Add export:

```typescript
export { kiroApi } from './kiro';
```

(Match existing pattern.)

- [ ] **Step 4: Verify build**

Run: `cd /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center && npm run typecheck 2>&1 | tail -10`
(or `npx tsc --noEmit`)

Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git -C /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center add src/types/kiro.ts src/services/api/kiro.ts src/services/api/index.ts
git -C /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center commit -m "feat(api): 添加 Kiro 登录 + 刷新 API client"
```

## Context

- The `apiClient` axios instance is in `src/services/api/client.ts` — already handles auth headers / base URL.
- **No "Co-Authored-By"** in commits.

---

## Task 3 (M4): KiroLoginCard Component

**Files:**
- Create: `src/features/authFiles/components/KiroLoginCard.tsx`
- Create: `src/features/authFiles/components/KiroLoginCard.module.scss`
- Modify: `src/i18n/locales/zh-CN.json` (add kiro_* keys)

- [ ] **Step 1: Add i18n keys**

Edit `src/i18n/locales/zh-CN.json`. Add a new top-level `kiro` block (or under `ai_providers`):

```json
"ai_providers": {
  "...": "...",
  "kiro_title": "Kiro 账号(AWS Amazon Q)",
  "kiro_desc": "通过 PKCE 浏览器登录或 AWS Builder ID 设备码登录,获取免费 Claude 模型额度。",
  "kiro_pkce_button_google": "用 Google 登录",
  "kiro_pkce_button_github": "用 GitHub 登录",
  "kiro_device_button": "用 AWS Builder ID 登录(设备码)",
  "kiro_open_browser_hint": "在浏览器中打开下方链接完成登录:",
  "kiro_device_user_code": "用户码",
  "kiro_device_open_url": "打开 URL 并输入上面的用户码",
  "kiro_device_polling": "等待用户授权...",
  "kiro_login_success": "登录成功!凭证已保存。",
  "kiro_login_error": "登录失败:{{error}}",
  "kiro_login_starting": "正在启动登录..."
}
```

- [ ] **Step 2: Create the component**

Create `src/features/authFiles/components/KiroLoginCard.tsx`:

```tsx
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
          // status === 'pending' → keep polling
        } catch (err) {
          // 404 likely means session expired; surface as error.
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
```

- [ ] **Step 3: Create the SCSS module**

Create `src/features/authFiles/components/KiroLoginCard.module.scss`:

```scss
.card {
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 8px;
  padding: 1.25rem;
  background: var(--color-card, #fff);
  margin-bottom: 1rem;
}

.title {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
  font-weight: 600;
}

.desc {
  margin: 0 0 1rem;
  color: var(--color-text-muted, #666);
  font-size: 0.9rem;
}

.section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--color-border-light, #f0f0f0);

  &:first-of-type {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }
}

.buttonRow {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-primary, #4a90e2);
  background: transparent;
  color: var(--color-primary, #4a90e2);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;

  &:hover:not(:disabled) {
    background: var(--color-primary-bg, rgba(74, 144, 226, 0.05));
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.hint {
  margin-top: 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text, #333);

  p {
    margin: 0.25rem 0;
  }
}

.link {
  color: var(--color-primary, #4a90e2);
  text-decoration: underline;
  word-break: break-all;
}

.code {
  background: var(--color-code-bg, #f5f5f5);
  padding: 0.125rem 0.5rem;
  border-radius: 3px;
  font-family: monospace;
  font-size: 1.05em;
  letter-spacing: 0.1em;
}

.muted {
  color: var(--color-text-muted, #999);
  font-style: italic;
}

.success {
  margin-top: 0.5rem;
  color: var(--color-success, #4caf50);
  font-weight: 500;
}

.error {
  margin-top: 0.5rem;
  color: var(--color-error, #f44336);
  font-size: 0.875rem;
}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center && npm run typecheck 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center add src/features/authFiles/components/KiroLoginCard.tsx src/features/authFiles/components/KiroLoginCard.module.scss src/i18n/locales/zh-CN.json
git -C /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center commit -m "feat(authFiles): 添加 KiroLoginCard 组件(PKCE + Device code 双 flow)"
```

## Context

- The component is self-contained — `<KiroLoginCard onSuccess={refresh} />` integrates with caller in Task 4.
- Polling uses 3s interval — matches typical Builder ID `interval` field from AWS.
- Window.open for PKCE — the local 19876 callback server (started by SDK during login) handles the browser redirect.

---

## Task 4 (M4): Embed in AuthFilesPage

**Files:**
- Modify: `src/pages/AuthFilesPage.tsx`

- [ ] **Step 1: Investigate the page structure**

Run: `cd /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center && grep -n "OAuthExcludedCard\|filter\|<section\|TabBar" src/pages/AuthFilesPage.tsx | head -20`

Find where existing cards (e.g., `<OAuthExcludedCard />`) are rendered. The natural spot for `<KiroLoginCard />` is at the top of the page, above the file list.

- [ ] **Step 2: Add the import + render**

Add the import (after existing component imports):
```typescript
import { KiroLoginCard } from '@/features/authFiles/components/KiroLoginCard';
```

Add the component at the top of the rendered JSX, ABOVE the existing file list / filter UI:
```tsx
<KiroLoginCard onSuccess={() => {
  // Trigger refresh of auth files. Use whatever existing hook does this —
  // likely useAuthFilesData has a refresh function. Look at how other cards
  // (e.g. OAuthExcludedCard) refresh after mutations.
  refetchAuthFiles?.();
}} />
```

If the existing data hook is `useAuthFilesData()`, check its return value for a refresh function. Adapt the `onSuccess` call to use the actual function name.

- [ ] **Step 3: Verify build + run dev server briefly to confirm no console errors**

Run: `cd /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center && npm run typecheck && npm run build 2>&1 | tail -10`
Expected: success.

(Optional manual: `npm run dev` → load page → see Kiro card appears at top of /auth-files. Don't block on this.)

- [ ] **Step 4: Commit**

```bash
git -C /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center add src/pages/AuthFilesPage.tsx
git -C /Users/pengzhouyang/github/Cli-Proxy-API-Management-Center commit -m "feat(authFiles): 在 AuthFilesPage 嵌入 KiroLoginCard"
```

## Context

- After this task, the user can:
  1. Open AuthFilesPage in browser → see Kiro login section at top
  2. Click "用 Google 登录" → browser opens, Kiro callback persists creds → list refreshes
  3. Click "AWS Builder ID 登录" → see user code → enter on AWS site → list refreshes
  4. Existing oauth_creds.json upload (`Type: kiro`) shows up under "Kiro" filter chip

---

## Task 5 (M5): config.example.yaml + README

**Files (in CLIProxyAPI repo, separate branch):**
- Modify: `/Users/pengzhouyang/github/CLIProxyAPI/config.example.yaml`
- Modify: `/Users/pengzhouyang/github/CLIProxyAPI/README.md`

- [ ] **Step 1: Switch to CLIProxyAPI repo + create M5 branch**

```bash
cd /Users/pengzhouyang/github/CLIProxyAPI
git checkout main
git checkout -b feat/kiro-provider-m5-docs
```

(M5 lives in CLIProxyAPI;M4 lived in the frontend repo. They're merged via separate PRs.)

- [ ] **Step 2: Add Kiro config block**

Run: `head -30 /Users/pengzhouyang/github/CLIProxyAPI/config.example.yaml`
to see current structure.

Append to `config.example.yaml` (or insert under existing provider config section):

```yaml
# Kiro provider (AWS Amazon Q / CodeWhisperer)
# All fields are optional — defaults match upstream Kiro IDE behavior.
# kiro:
#   default_region: us-east-1
#   social_provider: google              # google | github
#   device_code_polling_interval_sec: 5
#   device_code_timeout_sec: 300
#   callback_port_range: [19876, 19880]
#   builder_id_start_url: https://view.awsapps.com/start
```

- [ ] **Step 3: Add README section**

Run: `grep -n "^##\|^# " /Users/pengzhouyang/github/CLIProxyAPI/README.md | head -10`
Find a logical insertion point (e.g., right after the existing "Supported Providers" section).

Append a new section:

```markdown
### Kiro (AWS Amazon Q / CodeWhisperer)

Free Claude Sonnet 4.5 / Opus 4.7 access via your AWS Kiro IDE account.

**Setup:**

1. Install [Kiro IDE](https://kiro.dev/) and complete first-time login (any of: Google / GitHub / AWS Builder ID).
2. Locate the credential file at `~/.kiro/oauth_creds.json`.
3. Upload it via the management UI, or POST to:
   ```
   POST /v0/management/auth/upload  (multipart, file=oauth_creds.json)
   ```
4. Use any standard client — the proxy auto-routes Anthropic/OpenAI/Gemini requests through Kiro:
   ```
   curl http://localhost:8888/v1/messages \
     -H "Authorization: Bearer <PROXY_KEY>" \
     -d '{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":"hi"}]}'
   ```

**Server-side login (alternative):** The management API exposes endpoints for
PKCE / Builder ID device-code login, so you can authenticate from a
browser-less server (see `/v0/management/auth/kiro/login/*` in the API docs).

**Supported models:** claude-haiku-4-5, claude-sonnet-4-5 (default),
claude-sonnet-4-5-20250929, claude-sonnet-4-6, claude-opus-4-5,
claude-opus-4-5-20251101, claude-opus-4-6 (1M ctx), claude-opus-4-7 (1M ctx),
claude-sonnet-4-20250514, claude-3-7-sonnet-20250219.
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/pengzhouyang/github/CLIProxyAPI add config.example.yaml README.md
git -C /Users/pengzhouyang/github/CLIProxyAPI commit -m "docs(kiro): 添加 config 示例与 README 章节"
```

## M4 + M5 Done Criteria

- [ ] All 5 tasks above checked off
- [ ] Frontend `npm run build` succeeds
- [ ] Backend `go build ./...` still succeeds (M5 docs only, no code change)
- [ ] M4 PR opened on Soein/Cli-Proxy-API-Management-Center
- [ ] M5 PR opened on Soein/CLIProxyAPI

## Skipped (out of MVP scope)

- ❌ KiroEditPage (separate edit page like Claude/Codex have) — reuse generic AuthFileCard
- ❌ KiroModelsPage — models already exposed via existing /v1/models
- ❌ Per-Kiro-account zustand store — useState in component is sufficient
- ❌ en-US.json translations — zh-CN sufficient for first release
- ❌ Kiro 详细使用文档 docs/kiro.md — README section sufficient
- ❌ 集成测试套件 — backend tests already cover end-to-end
