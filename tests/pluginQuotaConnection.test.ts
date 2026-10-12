import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { apiClient } from '@/services/api/client';
import {
  fetchPluginQuota,
  resetPluginQuotaRouteCache,
} from '@/features/quota/providers/plugin/data';
import i18n from '@/i18n';
import type { AuthFileItem } from '@/types';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const rawPluginList = (
  plugins: Array<{
    id: string;
    registered?: boolean;
    supports_quota?: boolean;
    quota_provider?: string;
  }>
) => ({
  plugins_enabled: true,
  plugins_dir: 'plugins',
  plugins: plugins.map((p) => ({
    registered: true,
    supports_quota: true,
    ...p,
  })),
});

describe('plugin quota connection isolation and regression suite', () => {
  const instance = (apiClient as unknown as { instance: { defaults: { adapter?: AxiosAdapter } } })
    .instance;
  const originalAdapter = instance.defaults.adapter;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let events: Array<{ type: string; detail?: unknown }> = [];

  beforeEach(() => {
    resetPluginQuotaRouteCache();
    events = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: CustomEvent | Event) => {
          events.push({
            type: event.type,
            detail: 'detail' in event ? (event as CustomEvent).detail : undefined,
          });
          return true;
        },
      },
    });
  });

  afterEach(() => {
    instance.defaults.adapter = originalAdapter;
    apiClient.setConfig({ apiBase: '', managementKey: '' });
    resetPluginQuotaRouteCache();
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  test('1. Connection A -> B while list pending: old quota POST never dispatches to B; fresh B operation works', async () => {
    apiClient.setConfig({
      apiBase: 'https://server-a.invalid',
      managementKey: 'key-a',
    });

    const listADeferred = createDeferred<AxiosResponse>();
    const listADispatched = createDeferred<void>();
    const dispatched: Array<{ url?: string; baseURL?: string; data?: unknown }> = [];

    instance.defaults.adapter = async (config) => {
      dispatched.push({ url: config.url, baseURL: config.baseURL, data: config.data });
      if (
        config.url === '/plugins' &&
        config.baseURL === 'https://server-a.invalid/v8/management'
      ) {
        listADispatched.resolve();
        return listADeferred.promise;
      }
      if (
        config.url === '/plugins' &&
        config.baseURL === 'https://server-b.invalid/v8/management'
      ) {
        return {
          data: rawPluginList([{ id: 'kiro-b', quota_provider: 'kiro' }]),
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      }
      if (config.url === '/plugins/kiro-b/quota') {
        return {
          data: { subscription: { plan: 'Plan-B' } },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      }
      if (config.url === '/plugins/kiro-quota/quota') {
        return {
          data: { subscription: { plan: 'Plan-A' } },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      }
      throw new Error(`Unexpected request: ${config.baseURL} ${config.url}`);
    };

    const fileA: AuthFileItem = {
      name: 'kiro-a.json',
      authIndex: 'auth-a',
      quotaProvider: 'kiro',
    };
    const opA = fetchPluginQuota(fileA, i18n.t);

    // Wait until list request for A has been dispatched to adapter
    await listADispatched.promise;

    // Switch connection to B while list A is pending
    apiClient.setConfig({
      apiBase: 'https://server-b.invalid',
      managementKey: 'key-b',
    });

    // Deliver list response from server A
    listADeferred.resolve({
      data: rawPluginList([{ id: 'kiro-quota', quota_provider: 'kiro' }]),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: { url: '/plugins' } as InternalAxiosRequestConfig,
    });

    // Operation A must reject with cancellation
    await expect(opA).rejects.toHaveProperty('code', 'ERR_CANCELED');

    // Crucially: quota POST for A must NEVER have been dispatched (especially not to B)
    const quotaDispatchesA = dispatched.filter((r) => r.url === '/plugins/kiro-quota/quota');
    expect(quotaDispatchesA).toHaveLength(0);

    // Fresh operation on connection B must succeed
    const fileB: AuthFileItem = {
      name: 'kiro-b.json',
      authIndex: 'auth-b',
      quotaProvider: 'kiro',
    };
    const resultB = await fetchPluginQuota(fileB, i18n.t);
    expect(resultB.subscription?.plan).toBe('Plan-B');

    // Server B quota POST was correctly dispatched with server B baseURL and auth-b
    const quotaDispatchesB = dispatched.filter((r) => r.url === '/plugins/kiro-b/quota');
    expect(quotaDispatchesB).toHaveLength(1);
    expect(quotaDispatchesB[0].baseURL).toBe('https://server-b.invalid/v8/management');
    expect(
      typeof quotaDispatchesB[0].data === 'string'
        ? JSON.parse(quotaDispatchesB[0].data)
        : quotaDispatchesB[0].data
    ).toEqual({ auth_index: 'auth-b' });
  });

  describe('2. A->B->A, key-only change, and logout invalidate pending operation', () => {
    test('A -> B -> A invalidates pending operation even when URL/key match initial', async () => {
      apiClient.setConfig({
        apiBase: 'https://server-a.invalid',
        managementKey: 'key-a',
      });

      const listDeferred = createDeferred<AxiosResponse>();
      const listDispatched = createDeferred<void>();
      const dispatched: Array<{ url?: string; baseURL?: string }> = [];

      instance.defaults.adapter = async (config) => {
        dispatched.push({ url: config.url, baseURL: config.baseURL });
        if (config.url === '/plugins') {
          listDispatched.resolve();
          return listDeferred.promise;
        }
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      };

      const file: AuthFileItem = {
        name: 'kiro.json',
        authIndex: 'auth-1',
        quotaProvider: 'kiro',
      };
      const op = fetchPluginQuota(file, i18n.t);
      await listDispatched.promise;

      // Switch A -> B -> A
      apiClient.setConfig({
        apiBase: 'https://server-b.invalid',
        managementKey: 'key-b',
      });
      apiClient.setConfig({
        apiBase: 'https://server-a.invalid',
        managementKey: 'key-a',
      });

      // Resolve list
      listDeferred.resolve({
        data: rawPluginList([{ id: 'kiro-quota', quota_provider: 'kiro' }]),
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { url: '/plugins' } as InternalAxiosRequestConfig,
      });

      await expect(op).rejects.toHaveProperty('code', 'ERR_CANCELED');
      expect(dispatched.filter((r) => r.url?.includes('/quota'))).toHaveLength(0);
    });

    test('key-only change invalidates pending operation', async () => {
      apiClient.setConfig({
        apiBase: 'https://server-a.invalid',
        managementKey: 'key-1',
      });

      const listDeferred = createDeferred<AxiosResponse>();
      const listDispatched = createDeferred<void>();
      const dispatched: Array<{ url?: string; baseURL?: string }> = [];

      instance.defaults.adapter = async (config) => {
        dispatched.push({ url: config.url, baseURL: config.baseURL });
        if (config.url === '/plugins') {
          listDispatched.resolve();
          return listDeferred.promise;
        }
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      };

      const file: AuthFileItem = {
        name: 'kiro.json',
        authIndex: 'auth-1',
        quotaProvider: 'kiro',
      };
      const op = fetchPluginQuota(file, i18n.t);
      await listDispatched.promise;

      // Change key only
      apiClient.setConfig({
        apiBase: 'https://server-a.invalid',
        managementKey: 'key-2',
      });

      listDeferred.resolve({
        data: rawPluginList([{ id: 'kiro-quota', quota_provider: 'kiro' }]),
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { url: '/plugins' } as InternalAxiosRequestConfig,
      });

      await expect(op).rejects.toHaveProperty('code', 'ERR_CANCELED');
      expect(dispatched.filter((r) => r.url?.includes('/quota'))).toHaveLength(0);
    });

    test('logout invalidates pending operation', async () => {
      apiClient.setConfig({
        apiBase: 'https://server-a.invalid',
        managementKey: 'key-1',
      });

      const listDeferred = createDeferred<AxiosResponse>();
      const listDispatched = createDeferred<void>();
      const dispatched: Array<{ url?: string; baseURL?: string }> = [];

      instance.defaults.adapter = async (config) => {
        dispatched.push({ url: config.url, baseURL: config.baseURL });
        if (config.url === '/plugins') {
          listDispatched.resolve();
          return listDeferred.promise;
        }
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      };

      const file: AuthFileItem = {
        name: 'kiro.json',
        authIndex: 'auth-1',
        quotaProvider: 'kiro',
      };
      const op = fetchPluginQuota(file, i18n.t);
      await listDispatched.promise;

      // Logout
      apiClient.setConfig({
        apiBase: '',
        managementKey: '',
      });

      listDeferred.resolve({
        data: rawPluginList([{ id: 'kiro-quota', quota_provider: 'kiro' }]),
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { url: '/plugins' } as InternalAxiosRequestConfig,
      });

      await expect(op).rejects.toHaveProperty('code', 'ERR_CANCELED');
      expect(dispatched.filter((r) => r.url?.includes('/quota'))).toHaveLength(0);
    });
  });

  test.each([
    {
      timing: 'immediate',
      yieldMicrotask: false,
      expectedPostCalls: 0,
    },
    {
      timing: 'after one microtask',
      yieldMicrotask: true,
      expectedPostCalls: 1,
    },
  ])(
    '3. Switch between cached-list resolution / invocation and Axios dispatch rejects obsolete dispatch ($timing)',
    async ({ yieldMicrotask, expectedPostCalls }) => {
      apiClient.setConfig({
        apiBase: 'https://server-a.invalid',
        managementKey: 'key-a',
      });

      const dispatched: Array<{ url?: string; baseURL?: string }> = [];
      instance.defaults.adapter = async (config) => {
        dispatched.push({ url: config.url, baseURL: config.baseURL });
        if (config.url === '/plugins') {
          return {
            data: rawPluginList([{ id: 'kiro-quota', quota_provider: 'kiro' }]),
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        }
        if (config.url === '/plugins/kiro-quota/quota') {
          return {
            data: { subscription: { plan: 'Plan-A' } },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        }
        throw new Error(`Unexpected request: ${config.baseURL} ${config.url}`);
      };

      const file: AuthFileItem = {
        name: 'kiro.json',
        authIndex: 'auth-1',
        quotaProvider: 'kiro',
      };

      // First call warms the plugin-list cache on connection A
      await fetchPluginQuota(file, i18n.t);
      expect(dispatched.filter((r) => r.url === '/plugins')).toHaveLength(1);
      expect(dispatched.filter((r) => r.url === '/plugins/kiro-quota/quota')).toHaveLength(1);

      const postSpy = spyOn(apiClient, 'post');
      try {
        // Second call starts with cached list
        const op = fetchPluginQuota(file, i18n.t);

        if (yieldMicrotask) {
          await Promise.resolve();
        }

        expect(postSpy).toHaveBeenCalledTimes(expectedPostCalls);

        // Switch connection before Axios dispatch
        apiClient.setConfig({
          apiBase: 'https://server-b.invalid',
          managementKey: 'key-b',
        });

        await expect(op).rejects.toHaveProperty('code', 'ERR_CANCELED');
        // POST must not have been dispatched after connection switch
        expect(dispatched.filter((r) => r.url === '/plugins/kiro-quota/quota')).toHaveLength(1);
      } finally {
        postSpy.mockRestore();
      }
    }
  );

  describe('4. Bind both GET and POST: stale response suppression', () => {
    test.each([
      {
        target: 'GET list',
        stage: 'list' as const,
      },
      {
        target: 'POST quota',
        stage: 'quota' as const,
      },
    ])(
      '$target: stale successful headers must not update version/plugin metadata',
      async ({ stage }) => {
        apiClient.setConfig({
          apiBase: 'https://server-a.invalid',
          managementKey: 'key-a',
        });

        const deferred = createDeferred<AxiosResponse>();
        const targetDispatched = createDeferred<void>();
        let capturedConfig: InternalAxiosRequestConfig | undefined;

        instance.defaults.adapter = async (config) => {
          if (config.url === '/plugins') {
            if (stage === 'list') {
              capturedConfig = config;
              targetDispatched.resolve();
              return deferred.promise;
            }
            return {
              data: rawPluginList([{ id: 'kiro-quota', quota_provider: 'kiro' }]),
              status: 200,
              statusText: 'OK',
              headers: {},
              config,
            };
          }
          if (config.url === '/plugins/kiro-quota/quota') {
            if (stage === 'quota') {
              capturedConfig = config;
              targetDispatched.resolve();
              return deferred.promise;
            }
            return {
              data: {},
              status: 200,
              statusText: 'OK',
              headers: {},
              config,
            };
          }
          throw new Error(`Unexpected request: ${config.url}`);
        };

        const file: AuthFileItem = {
          name: 'kiro.json',
          authIndex: 'auth-1',
          quotaProvider: 'kiro',
        };
        const op = fetchPluginQuota(file, i18n.t);
        await targetDispatched.promise;

        // Switch to connection B while target request is in-flight
        apiClient.setConfig({
          apiBase: 'https://server-b.invalid',
          managementKey: 'key-b',
        });

        // Deliver delayed response from server A with version/plugin headers
        deferred.resolve({
          data:
            stage === 'list' ? rawPluginList([{ id: 'kiro-quota', quota_provider: 'kiro' }]) : {},
          status: 200,
          statusText: 'OK',
          headers: {
            'x-cpa-version': 'v99.0.0',
            'x-cpa-support-plugin': 'false',
          },
          config: capturedConfig!,
        });

        await expect(op).rejects.toHaveProperty('code', 'ERR_CANCELED');
        expect(events).toEqual([]);
      }
    );

    test.each([
      {
        target: 'GET list',
        stage: 'list' as const,
      },
      {
        target: 'POST quota',
        stage: 'quota' as const,
      },
    ])('$target: stale 401 must not emit unauthorized on new connection', async ({ stage }) => {
      apiClient.setConfig({
        apiBase: 'https://server-a.invalid',
        managementKey: 'key-a',
      });

      const deferred = createDeferred<AxiosResponse>();
      const targetDispatched = createDeferred<void>();
      let capturedConfig: InternalAxiosRequestConfig | undefined;

      instance.defaults.adapter = async (config) => {
        if (config.url === '/plugins') {
          if (stage === 'list') {
            capturedConfig = config;
            targetDispatched.resolve();
            return deferred.promise;
          }
          return {
            data: rawPluginList([{ id: 'kiro-quota', quota_provider: 'kiro' }]),
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        }
        if (config.url === '/plugins/kiro-quota/quota') {
          if (stage === 'quota') {
            capturedConfig = config;
            targetDispatched.resolve();
            return deferred.promise;
          }
          return {
            data: {},
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        }
        throw new Error(`Unexpected request: ${config.url}`);
      };

      const file: AuthFileItem = {
        name: 'kiro.json',
        authIndex: 'auth-1',
        quotaProvider: 'kiro',
      };
      const op = fetchPluginQuota(file, i18n.t);
      // Attach catch handler early so Bun does not treat rejection during test as unhandled
      const caughtPromise = op.catch((err) => err);
      await targetDispatched.promise;

      // Switch to connection B while target request is in-flight
      apiClient.setConfig({
        apiBase: 'https://server-b.invalid',
        managementKey: 'key-b',
      });

      // Reject with 401
      deferred.reject(
        new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', capturedConfig, undefined, {
          data: { error: 'Invalid management key' },
          status: 401,
          statusText: 'Unauthorized',
          headers: new AxiosHeaders(),
          config: capturedConfig!,
        })
      );

      const caught = await caughtPromise;
      expect(caught).toBeDefined();
      // unauthorized event must NOT be dispatched
      expect(events.map((e) => e.type)).not.toContain('unauthorized');
    });
  });

  describe('5. Happy path retains same-connection deduplication, TTL, encoding, and cache resilience', () => {
    test('same-connection deduplication and TTL cache reuse', async () => {
      apiClient.setConfig({
        apiBase: 'https://server-a.invalid',
        managementKey: 'key-a',
      });

      let listCount = 0;
      let postCount = 0;
      instance.defaults.adapter = async (config) => {
        if (config.url === '/plugins') {
          listCount += 1;
          return {
            data: rawPluginList([{ id: 'kiro-quota', quota_provider: 'kiro' }]),
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        }
        if (config.url === '/plugins/kiro-quota/quota') {
          postCount += 1;
          return {
            data: { subscription: { plan: 'Pro' } },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        }
        throw new Error(`Unexpected: ${config.url}`);
      };

      // Two concurrent calls on same connection
      const [res1, res2] = await Promise.all([
        fetchPluginQuota({ name: '1.json', authIndex: '1', quotaProvider: 'kiro' }, i18n.t),
        fetchPluginQuota({ name: '2.json', authIndex: '2', quotaProvider: 'kiro' }, i18n.t),
      ]);

      expect(res1.subscription?.plan).toBe('Pro');
      expect(res2.subscription?.plan).toBe('Pro');
      // Shared single GET /plugins call
      expect(listCount).toBe(1);
      expect(postCount).toBe(2);

      // Third call within TTL reuses cached list
      await fetchPluginQuota({ name: '3.json', authIndex: '3', quotaProvider: 'kiro' }, i18n.t);
      expect(listCount).toBe(1);
      expect(postCount).toBe(3);
    });

    test('encodes plugin ID and passes auth_index', async () => {
      apiClient.setConfig({
        apiBase: 'https://server-a.invalid',
        managementKey: 'key-a',
      });

      let capturedUrl: string | undefined;
      let capturedBody: unknown;

      instance.defaults.adapter = async (config) => {
        if (config.url === '/plugins') {
          return {
            data: rawPluginList([{ id: 'special/plugin:id', quota_provider: 'custom-quota' }]),
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        }
        if (config.url?.startsWith('/plugins/')) {
          capturedUrl = config.url;
          capturedBody = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
          return {
            data: { subscription: { plan: 'Special' } },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        }
        throw new Error(`Unexpected: ${config.url}`);
      };

      const result = await fetchPluginQuota(
        { name: 'custom.json', authIndex: 'user:42', quotaProvider: 'custom-quota' },
        i18n.t
      );

      expect(result.subscription?.plan).toBe('Special');
      expect(capturedUrl).toBe('/plugins/special%2Fplugin%3Aid/quota');
      expect(capturedBody).toEqual({ auth_index: 'user:42' });
    });

    test('new connection cache is resilient to an old connection rejection', async () => {
      apiClient.setConfig({
        apiBase: 'https://server-a.invalid',
        managementKey: 'key-a',
      });

      const listADeferred = createDeferred<AxiosResponse>();
      const listADispatched = createDeferred<void>();
      let bListCount = 0;

      instance.defaults.adapter = async (config) => {
        if (
          config.url === '/plugins' &&
          config.baseURL === 'https://server-a.invalid/v8/management'
        ) {
          listADispatched.resolve();
          return listADeferred.promise;
        }
        if (
          config.url === '/plugins' &&
          config.baseURL === 'https://server-b.invalid/v8/management'
        ) {
          bListCount += 1;
          return {
            data: rawPluginList([{ id: 'kiro-b', quota_provider: 'kiro' }]),
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        }
        if (config.url === '/plugins/kiro-b/quota') {
          return {
            data: { subscription: { plan: 'Plan-B' } },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        }
        throw new Error(`Unexpected: ${config.baseURL} ${config.url}`);
      };

      // 1. Request on Connection A starts
      const opA = fetchPluginQuota(
        { name: 'a.json', authIndex: 'a', quotaProvider: 'kiro' },
        i18n.t
      );
      const opACaught = opA.catch((err) => err);
      await listADispatched.promise;

      // 2. Switch to Connection B
      apiClient.setConfig({
        apiBase: 'https://server-b.invalid',
        managementKey: 'key-b',
      });

      // 3. Request on Connection B succeeds and caches list for Connection B
      const opB1 = await fetchPluginQuota(
        { name: 'b1.json', authIndex: 'b1', quotaProvider: 'kiro' },
        i18n.t
      );
      expect(opB1.subscription?.plan).toBe('Plan-B');
      expect(bListCount).toBe(1);

      // 4. Old Connection A list now rejects
      listADeferred.reject(new Error('Network error on old server A'));
      await expect(opACaught).resolves.toBeDefined();

      // 5. Subsequent request on Connection B must still use Connection B cache and NOT re-fetch list
      const opB2 = await fetchPluginQuota(
        { name: 'b2.json', authIndex: 'b2', quotaProvider: 'kiro' },
        i18n.t
      );
      expect(opB2.subscription?.plan).toBe('Plan-B');
      expect(bListCount).toBe(1); // Still 1! Cache was not evicted by old A rejection.
    });
  });
});
