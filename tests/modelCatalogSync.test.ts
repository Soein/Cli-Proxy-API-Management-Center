import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { getModelCatalogRefreshFailure, modelsApi } from '../src/services/api';
import { apiClient } from '../src/services/api/client';

const read = (path: string) => readFileSync(path, 'utf8');
const hook = read('src/features/authFiles/hooks/useModelCatalogSync.ts');
const systemPage = read('src/pages/SystemPage.tsx');

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

  test('pins a scoped catalog update to its owning management connection', async () => {
    const client = apiClient.captureConnection();
    const post = spyOn(client, 'post').mockResolvedValue({ changed_providers: [] });
    const capture = spyOn(apiClient, 'captureConnection').mockReturnValue(client);
    const isCurrent = () => true;
    try {
      expect(await modelsApi.refreshCatalog(isCurrent)).toEqual({ changedProviders: [] });
      expect(capture).toHaveBeenCalledWith(isCurrent);
      expect(post).toHaveBeenCalledWith('/models/refresh');
    } finally {
      capture.mockRestore();
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
    expect(callback).toContain('void showModels(');
    expect(callback).not.toContain('invalidateDerivedCaches');
    // The alias diagram left this page: the model rules workspace fetches provider catalogs
    // fresh on mount, so the page no longer keeps a catalog version to re-trigger them.
    expect(page).not.toContain('modelCatalogVersion');
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const translations = JSON.parse(read(`src/i18n/locales/${locale}.json`));
      const system = translations.system_info;
      expect(system.models_desc).toContain(system.models_refresh_button);
      expect(system.models_desc).toContain(system.models_catalog_refresh_button);
      const messages = translations.auth_files;
      expect(messages).not.toHaveProperty('sync_catalog_tooltip');
      for (const key of ['button', 'success', 'unchanged', 'failed']) {
        expect(messages[`sync_catalog_${key}`]).toBeTruthy();
      }
      expect(messages.sync_catalog_success).toContain('{{providers}}');
    }
  });
});

function systemPageHarness(initialModels: string[] = ['gpt-4']) {
  let revision = 1;
  let storeModels = initialModels.map((name) => ({ name }));
  let storeCache: { data: { name: string }[]; timestamp: number } | null = {
    data: storeModels,
    timestamp: Date.now(),
  };
  let syncingModelCatalog = false;
  let modelsRequestLoading = false;
  let modelsLoading = false;
  let clearCacheCalls = 0;
  let fetchModelsStoreCalls = 0;
  let modelStatus: { type: 'warning' | 'error'; message: string } | undefined;
  const notifications: unknown[][] = [];
  let resolveRefresh: (value: { changedProviders: string[] }) => void = () => {};
  let rejectRefresh: (error: unknown) => void = () => {};
  let resolveList: (value: { name: string }[]) => void = () => {};
  let rejectList: (error: unknown) => void = () => {};
  let nextListOutcome:
    { ok: true; list: { name: string }[] } | { ok: false; error: unknown } | null = null;
  let refreshCalls = 0;
  const auth = { connectionStatus: 'connected', apiBase: 'https://api.example.com' };
  const modelsRequestId = { current: 0 };
  const catalogRequestId = { current: 0 };

  const syncModelsLoading = () => {
    modelsLoading = modelsRequestLoading;
  };

  const env = {
    auth,
    modelsRequestId,
    catalogRequestId,
    apiClient: { getConnectionRevision: () => revision },
    get syncingModelCatalog() {
      return syncingModelCatalog;
    },
    get modelsLoading() {
      return modelsLoading;
    },
    setModelStatus: (value: { type: 'warning' | 'error'; message: string } | undefined) => {
      modelStatus = value;
    },
    setModelsRequestLoading: (value: boolean) => {
      modelsRequestLoading = value;
      syncModelsLoading();
    },
    setSyncingModelCatalog: (value: boolean) => {
      syncingModelCatalog = value;
    },
    resolveApiKeysForModels: async () => ['sk-test'],
    fetchModelsFromStore: async (_apiBase: string, _key?: string, forceRefresh = false) => {
      fetchModelsStoreCalls += 1;
      if (!forceRefresh && storeCache) {
        storeModels = storeCache.data;
        return storeCache.data;
      }
      const list = await new Promise<{ name: string }[]>((res, rej) => {
        if (nextListOutcome) {
          const outcome = nextListOutcome;
          nextListOutcome = null;
          if (outcome.ok) res(outcome.list);
          else rej(outcome.error);
          return;
        }
        resolveList = res;
        rejectList = rej;
      });
      storeModels = list;
      storeCache = { data: list, timestamp: Date.now() };
      return list;
    },
    useModelsStore: {
      getState: () => ({
        clearCache: () => {
          clearCacheCalls += 1;
          storeCache = null;
          storeModels = [];
        },
      }),
    },
    modelsApi: {
      refreshCatalog: (isCurrent?: () => boolean) => {
        refreshCalls += 1;
        if (isCurrent && !isCurrent()) {
          return Promise.reject(new Error('stale before start'));
        }
        return new Promise<{ changedProviders: string[] }>((res, rej) => {
          resolveRefresh = res;
          rejectRefresh = rej;
        });
      },
    },
    getModelCatalogRefreshFailure,
    showNotification: (...args: unknown[]) => notifications.push(args),
    t: (key: string, params?: { count?: number }) =>
      params?.count !== undefined ? `${key}:${params.count}` : key,
  };

  const block = systemPage.slice(
    systemPage.indexOf('  const fetchModels ='),
    systemPage.indexOf('  const handleClearLoginStorage =')
  );
  const js = ts.transpileModule(`${block}\nreturn { fetchModels, handleCatalogRefresh };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const fns = new Function('__env', `with (__env) {\n${js}\n}`)(env) as {
    fetchModels: (opts?: { forceRefresh?: boolean; notify?: boolean }) => Promise<boolean>;
    handleCatalogRefresh: () => Promise<void>;
  };

  return {
    fetchModels: fns.fetchModels,
    handleCatalogRefresh: fns.handleCatalogRefresh,
    resolveRefresh: (providers: string[] = []) => resolveRefresh({ changedProviders: providers }),
    rejectRefresh: (error: unknown = new Error('refresh failed')) => rejectRefresh(error),
    resolveList: (names: string[]) => resolveList(names.map((name) => ({ name }))),
    rejectList: (error: unknown = new Error('503 Service Unavailable')) => rejectList(error),
    waitForListRequest: async () => {
      for (let i = 0; i < 10 && fetchModelsStoreCalls === 0; i++) {
        await Promise.resolve();
      }
    },
    queueListSuccess: (names: string[]) => {
      nextListOutcome = { ok: true, list: names.map((name) => ({ name })) };
    },
    queueListFailure: (error: unknown = new Error('503 Service Unavailable')) => {
      nextListOutcome = { ok: false, error };
    },
    switchConnection: () => {
      revision += 1;
      modelsRequestId.current += 1;
      catalogRequestId.current += 1;
      storeCache = null;
      storeModels = [];
    },
    unmount: () => {
      modelsRequestId.current += 1;
      catalogRequestId.current += 1;
    },
    setApiBase: (value: string) => {
      auth.apiBase = value;
    },
    get refreshCalls() {
      return refreshCalls;
    },
    get clearCacheCalls() {
      return clearCacheCalls;
    },
    get fetchModelsStoreCalls() {
      return fetchModelsStoreCalls;
    },
    get storeModels() {
      return storeModels;
    },
    get storeCache() {
      return storeCache;
    },
    get modelStatus() {
      return modelStatus;
    },
    get syncing() {
      return syncingModelCatalog;
    },
    get modelsLoading() {
      return modelsRequestLoading;
    },
    notifications,
  };
}

describe('system page model catalog refresh', () => {
  test('wires getModelCatalogRefreshFailure and shared models store cache invalidation', () => {
    expect(systemPage).toContain('getModelCatalogRefreshFailure');
    expect(systemPage).toContain("from '@/services/api'");
    expect(systemPage).toContain('useModelsStore.getState().clearCache()');
    expect(systemPage).toContain('modelsApi.refreshCatalog(isCurrent)');
  });

  test('full success invalidates shared cache, reloads list, and notifies once', async () => {
    const h = systemPageHarness(['old-model']);
    const pending = h.handleCatalogRefresh();
    expect(h.syncing).toBe(true);
    h.queueListSuccess(['fresh-model']);
    h.resolveRefresh(['claude']);
    await pending;

    expect(h.syncing).toBe(false);
    expect(h.modelsLoading).toBe(false);
    expect(h.clearCacheCalls).toBe(1);
    expect(h.fetchModelsStoreCalls).toBe(1);
    expect(h.storeModels).toEqual([{ name: 'fresh-model' }]);
    expect(h.modelStatus).toBeUndefined();
    expect(h.notifications).toEqual([['system_info.models_catalog_refresh_success', 'success']]);
  });

  test('200 POST followed by 503 GET shows existing list error without all-success or catalog-failure toast', async () => {
    const h = systemPageHarness(['old-model']);
    const pending = h.handleCatalogRefresh();
    h.queueListFailure(new Error('Request failed with status code 503'));
    h.resolveRefresh(['claude']);
    await pending;

    expect(h.syncing).toBe(false);
    expect(h.modelsLoading).toBe(false);
    expect(h.clearCacheCalls).toBe(1);
    expect(h.fetchModelsStoreCalls).toBe(1);
    expect(h.storeCache).toBeNull();
    expect(h.modelStatus).toEqual({
      type: 'error',
      message: 'system_info.models_error: Request failed with status code 503',
    });
    expect(h.notifications).toEqual([]);
  });

  test('early exit in fetchModels prevents all-success toast', async () => {
    const h = systemPageHarness(['old-model']);
    h.setApiBase('');
    const pending = h.handleCatalogRefresh();
    h.resolveRefresh([]);
    await pending;

    expect(h.fetchModelsStoreCalls).toBe(0);
    expect(h.notifications).toEqual([['notification.connection_required', 'warning']]);
  });

  test('manual refresh retains existing feedback for empty, nonempty, and error loads', async () => {
    const h = systemPageHarness();
    h.queueListSuccess([]);
    expect(await h.fetchModels({ forceRefresh: true, notify: true })).toBe(true);
    expect(h.notifications[0]).toEqual(['system_info.models_refresh_success:0', 'success']);

    h.queueListSuccess(['gpt-5']);
    expect(await h.fetchModels({ forceRefresh: true, notify: true })).toBe(true);
    expect(h.notifications[1]).toEqual(['system_info.models_refresh_success:1', 'success']);

    h.queueListFailure(new Error('503'));
    expect(await h.fetchModels({ forceRefresh: true, notify: true })).toBe(false);
    expect(h.modelStatus).toEqual({ type: 'error', message: 'system_info.models_error: 503' });
    expect(h.notifications[2]).toEqual(['system_info.models_error: 503', 'error']);
  });

  test('ordinary failure and empty changed_providers preserve valid cache and list', async () => {
    for (const error of [
      new Error('500 Internal Server Error'),
      Object.assign(new Error('502 Bad Gateway'), { data: { changed_providers: [] } }),
    ]) {
      const h = systemPageHarness(['kept-model']);
      const initialCache = h.storeCache;
      const pending = h.handleCatalogRefresh();
      h.rejectRefresh(error);
      await pending;

      expect(h.clearCacheCalls).toBe(0);
      expect(h.fetchModelsStoreCalls).toBe(0);
      expect(h.storeCache).toBe(initialCache);
      expect(h.storeModels).toEqual([{ name: 'kept-model' }]);
      expect(h.notifications).toEqual([
        [`system_info.models_catalog_refresh_failed: ${error.message}`, 'error'],
      ]);
      expect(h.syncing).toBe(false);
    }
  });

  test('502 partial failure invalidates cache, reloads list, and keeps failure notification', async () => {
    const h = systemPageHarness(['stale-model']);
    const pending = h.handleCatalogRefresh();
    h.queueListSuccess(['claude-opus-4']);
    h.rejectRefresh(
      Object.assign(new Error('Codex catalog unavailable'), {
        data: { changed_providers: [' claude ', null, ''] },
      })
    );
    await pending;

    expect(h.clearCacheCalls).toBe(1);
    expect(h.fetchModelsStoreCalls).toBe(1);
    expect(h.storeModels).toEqual([{ name: 'claude-opus-4' }]);
    expect(h.notifications).toEqual([
      ['system_info.models_catalog_refresh_failed: Codex catalog unavailable', 'error'],
    ]);
    expect(h.syncing).toBe(false);
  });

  test('502 partial failure with 503 GET shows both list error and catalog failure notification', async () => {
    const h = systemPageHarness(['stale-model']);
    const pending = h.handleCatalogRefresh();
    h.queueListFailure(new Error('503'));
    h.rejectRefresh(
      Object.assign(new Error('Codex catalog unavailable'), {
        details: { changed_providers: ['claude'] },
      })
    );
    await pending;

    expect(h.clearCacheCalls).toBe(1);
    expect(h.fetchModelsStoreCalls).toBe(1);
    expect(h.modelStatus).toEqual({ type: 'error', message: 'system_info.models_error: 503' });
    expect(h.notifications).toEqual([
      ['system_info.models_catalog_refresh_failed: Codex catalog unavailable', 'error'],
    ]);
  });

  for (const stale of ['switchConnection', 'unmount'] as const) {
    test(`ignores stale completion on ${stale} after refreshCatalog`, async () => {
      const h = systemPageHarness(['kept']);
      const pending = h.handleCatalogRefresh();
      h[stale]();
      h.resolveRefresh(['claude']);
      await pending;

      expect(h.clearCacheCalls).toBe(0);
      expect(h.fetchModelsStoreCalls).toBe(0);
      expect(h.notifications).toEqual([]);
    });

    test(`ignores stale completion on ${stale} across the extra list-reload await after 200 POST`, async () => {
      const h = systemPageHarness(['kept']);
      const pending = h.handleCatalogRefresh();
      h.resolveRefresh(['claude']);
      await h.waitForListRequest();
      expect(h.fetchModelsStoreCalls).toBe(1);
      h[stale]();
      h.resolveList(['stale-new']);
      await pending;

      expect(h.notifications).toEqual([]);
      expect(h.modelStatus).toBeUndefined();
    });

    test(`ignores stale completion on ${stale} across the extra list-reload await after 502 partial failure`, async () => {
      const h = systemPageHarness(['kept']);
      const pending = h.handleCatalogRefresh();
      h.rejectRefresh(
        Object.assign(new Error('Codex catalog unavailable'), {
          data: { changed_providers: ['claude'] },
        })
      );
      await h.waitForListRequest();
      expect(h.fetchModelsStoreCalls).toBe(1);
      h[stale]();
      h.rejectList(new Error('503'));
      await pending;

      expect(h.notifications).toEqual([]);
      expect(h.modelStatus).toBeUndefined();
    });
  }
});
