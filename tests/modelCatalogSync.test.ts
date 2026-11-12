import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { getModelCatalogRefreshFailure, modelsApi } from '../src/services/api/models';
import { apiClient } from '../src/services/api/client';

const read = (path: string) => readFileSync(path, 'utf8');
const hook = read('src/features/authFiles/hooks/useModelCatalogSync.ts');

function harness() {
  let revision = 1;
  let resolve!: (value: { changedProviders: string[] }) => void;
  let reject!: (error: unknown) => void;
  let calls = 0;
  let invalidations = 0;
  let refetches = 0;
  let loading = false;
  const notifications: unknown[][] = [];
  const mountedRef = { current: true };
  const env = {
    useCallback: (fn: unknown) => fn,
    pendingRef: { current: false },
    mountedRef,
    apiClient: { getConnectionRevision: () => revision },
    useAuthStore: { getState: () => ({ connectionStatus: 'connected' }) },
    modelsApi: {
      refreshCatalog: () => {
        calls++;
        return new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
      },
    },
    getModelCatalogRefreshFailure,
    useModelsStore: { getState: () => ({ clearCache: () => invalidations++ }) },
    onSyncedRef: { current: () => refetches++ },
    setSyncingModelCatalog: (value: boolean) => {
      loading = value;
    },
    showNotification: (...args: unknown[]) => notifications.push(args),
    t: (key: string, params?: { providers: string }) => `${key}${params?.providers ?? ''}`,
  };
  const block = hook.slice(hook.indexOf('  const syncModelCatalog ='), hook.indexOf('  return {'));
  const js = ts.transpileModule(`${block}\nreturn syncModelCatalog;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return {
    sync: new Function(...Object.keys(env), js)(...Object.values(env)) as () => Promise<void>,
    resolve: (providers: string[]) => resolve({ changedProviders: providers }),
    reject: (error: unknown = new Error('fixture failure')) => reject(error),
    switchConnection: () => revision++,
    unmount: () => {
      mountedRef.current = false;
    },
    notifications,
    get calls() {
      return calls;
    },
    get invalidations() {
      return invalidations;
    },
    get refetches() {
      return refetches;
    },
    get loading() {
      return loading;
    },
  };
}

describe('global model catalog sync', () => {
  test('posts through the management client and normalizes null providers', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({ ok: true, changed_providers: null });
    try {
      expect(await modelsApi.refreshCatalog()).toEqual({ changedProviders: [] });
      expect(post).toHaveBeenCalledWith('/models/refresh');
      post.mockResolvedValue({ ok: true, changed_providers: ['claude'] });
      expect(await modelsApi.refreshCatalog()).toEqual({ changedProviders: ['claude'] });
    } finally {
      post.mockRestore();
    }
  });

  for (const providers of [[], ['claude', 'codex']]) {
    test(`invalidates and refetches even when unchanged: ${providers}`, async () => {
      const h = harness();
      const pending = h.sync();
      await h.sync();
      expect(h.calls).toBe(1);
      expect(h.loading).toBe(true);
      h.resolve(providers);
      await pending;
      expect(h.loading).toBe(false);
      expect(h.invalidations).toBe(1);
      expect(h.refetches).toBe(1);
      expect(h.notifications[0]).toEqual([
        providers.length
          ? 'auth_files.sync_catalog_successclaude, codex'
          : 'auth_files.sync_catalog_unchanged',
        'success',
      ]);
    });
  }

  test('reports errors without clearing valid caches and allows retry', async () => {
    const h = harness();
    const pending = h.sync();
    h.reject();
    await pending;
    expect(h.notifications[0]).toEqual([
      'auth_files.sync_catalog_failed: fixture failure',
      'error',
    ]);
    expect(h.invalidations).toBe(0);
    expect(h.refetches).toBe(0);
    expect(h.loading).toBe(false);
    const retry = h.sync();
    h.resolve([]);
    await retry;
    expect(h.calls).toBe(2);
  });

  test('keeps valid caches when failure has empty changed_providers', async () => {
    const h = harness();
    const pending = h.sync();
    h.reject(
      Object.assign(new Error('502 Bad Gateway'), {
        data: { changed_providers: [] },
      })
    );
    await pending;
    expect(h.notifications[0]).toEqual([
      'auth_files.sync_catalog_failed: 502 Bad Gateway',
      'error',
    ]);
    expect(h.invalidations).toBe(0);
    expect(h.refetches).toBe(0);
    expect(h.loading).toBe(false);
  });

  test('invalidates cache and refetches on partial failure while showing error and allowing retry', async () => {
    const h = harness();
    const pending = h.sync();
    await h.sync();
    expect(h.calls).toBe(1);
    expect(h.loading).toBe(true);
    h.reject(
      Object.assign(new Error('Codex catalog unavailable'), {
        data: { changed_providers: [' claude ', null, ''] },
      })
    );
    await pending;
    expect(h.loading).toBe(false);
    expect(h.invalidations).toBe(1);
    expect(h.refetches).toBe(1);
    expect(h.notifications[0]).toEqual([
      'auth_files.sync_catalog_failed: Codex catalog unavailable',
      'error',
    ]);
    const retry = h.sync();
    expect(h.calls).toBe(2);
    h.resolve([]);
    await retry;
    expect(h.loading).toBe(false);
    expect(h.invalidations).toBe(2);
    expect(h.refetches).toBe(2);
  });

  for (const stale of ['switchConnection', 'unmount'] as const) {
    for (const fail of [false, true]) {
      test(`ignores stale ${fail ? 'error' : 'success'} after ${stale}`, async () => {
        const h = harness();
        const pending = h.sync();
        h[stale]();
        if (fail) h.reject();
        else h.resolve(['claude']);
        await pending;
        expect(h.notifications).toEqual([]);
        expect(h.invalidations).toBe(0);
        expect(h.refetches).toBe(0);
      });
    }

    test(`ignores stale partial failure after ${stale}`, async () => {
      const h = harness();
      const pending = h.sync();
      h[stale]();
      h.reject(
        Object.assign(new Error('Codex catalog unavailable'), {
          details: { changed_providers: ['claude'] },
        })
      );
      await pending;
      expect(h.notifications).toEqual([]);
      expect(h.invalidations).toBe(0);
      expect(h.refetches).toBe(0);
      expect(h.loading).toBe(stale === 'unmount');
    });
  }

  test('places secondary sync first and wires model-only cache refresh', () => {
    const header = read('src/features/authFiles/components/VaultHeader.tsx');
    const actions = header.slice(header.indexOf('<div className={styles.actions}'));
    expect(actions.indexOf('onClick={onSyncModelCatalog}')).toBeLessThan(
      actions.indexOf('onClick={onRefreshCredentials}')
    );
    expect(actions.slice(0, actions.indexOf('{onRefreshCredentials'))).toContain(
      'styles.ghostAction'
    );
    expect(actions.slice(0, actions.indexOf('{onRefreshCredentials'))).not.toContain('title=');
    const page = read('src/features/authFiles/AuthFilesPage.tsx');
    const callback = page.slice(
      page.indexOf('useModelCatalogSync(() =>'),
      page.indexOf('const invalidateDerivedCaches')
    );
    expect(callback).toContain('invalidateModels()');
    expect(callback).toContain('setModelCatalogVersion');
    expect(callback).toContain('void showModels(');
    expect(callback).not.toContain('invalidateDerivedCaches');
    const oauth = read('src/features/authFiles/hooks/useAuthFilesOauth.tsx');
    expect(oauth).toContain('[providerList, viewMode, modelCatalogVersion]');
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`)).auth_files;
      expect(messages).not.toHaveProperty('sync_catalog_tooltip');
      for (const key of ['button', 'success', 'unchanged', 'failed']) {
        expect(messages[`sync_catalog_${key}`]).toBeTruthy();
      }
      expect(messages.sync_catalog_success).toContain('{{providers}}');
    }
  });
});
