import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';
import { apiClient } from '@/services/api/client';
import { usageApi } from '@/services/api/usage';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

describe('custom v0 management usage extension', () => {
  test('keeps core v8 endpoints unaffected using the standard v8 prefix', async () => {
    apiClient.setConfig({
      apiBase: 'https://proxy.invalid/gateway',
      managementKey: 'fixture-key-v8',
    });

    let inspectedConfig: Parameters<AxiosAdapter>[0] | null = null;
    const adapter: AxiosAdapter = async (config) => {
      inspectedConfig = config;
      return {
        data: { status: 'ok' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    await apiClient.get('/config', { adapter });
    expect(inspectedConfig).not.toBeNull();
    expect(inspectedConfig!.baseURL).toBe('https://proxy.invalid/gateway/v8/management');
    expect(inspectedConfig!.url).toBe('/config');
    expect(inspectedConfig!.headers.Authorization).toBe('Bearer fixture-key-v8');
  });

  test('delegates all usage operations to apiClient with useV0Management and 60-second timeout', async () => {
    const getSpy = spyOn(apiClient, 'get').mockResolvedValue({
      usage: { apis: {} },
      total_requests: 0,
    } as unknown as AxiosResponse['data']);
    const postSpy = spyOn(apiClient, 'post').mockResolvedValue({
      added: 1,
      total_requests: 1,
    } as unknown as AxiosResponse['data']);

    try {
      // 1. getUsage
      await usageApi.getUsage({
        from: '2025-01-01T00:00:00Z',
        to: '2025-01-02T00:00:00Z',
        granularity: 'hour',
      });
      expect(getSpy).toHaveBeenLastCalledWith('/usage', {
        params: {
          from: '2025-01-01T00:00:00Z',
          to: '2025-01-02T00:00:00Z',
          granularity: 'hour',
        },
        timeout: 60000,
        useV0Management: true,
      });

      // 2. getUsageDetails
      await usageApi.getUsageDetails({
        from: '2025-01-01T00:00:00Z',
        to: '2025-01-02T00:00:00Z',
        granularity: 'day',
      });
      expect(getSpy).toHaveBeenLastCalledWith('/usage', {
        params: {
          from: '2025-01-01T00:00:00Z',
          to: '2025-01-02T00:00:00Z',
          granularity: 'day',
          include: 'details',
        },
        timeout: 60000,
        useV0Management: true,
      });

      // 3. exportUsage
      await usageApi.exportUsage();
      expect(getSpy).toHaveBeenLastCalledWith('/usage/export', {
        timeout: 60000,
        useV0Management: true,
      });

      // 4. importUsage
      await usageApi.importUsage({ records: [1, 2, 3] });
      expect(postSpy).toHaveBeenLastCalledWith(
        '/usage/import',
        { records: [1, 2, 3] },
        {
          timeout: 60000,
          useV0Management: true,
        }
      );

      // 5. getKeyStats with precomputed payload (skips network)
      const cachedStats = await usageApi.getKeyStats({ apis: {} });
      expect(cachedStats).toEqual({ bySource: {}, byAuthIndex: {} });
      expect(getSpy).toHaveBeenCalledTimes(3);

      // 6. getKeyStats without payload (fetches from /usage)
      await usageApi.getKeyStats();
      expect(getSpy).toHaveBeenCalledTimes(4);
      expect(getSpy).toHaveBeenLastCalledWith('/usage', {
        timeout: 60000,
        useV0Management: true,
      });
    } finally {
      getSpy.mockRestore();
      postSpy.mockRestore();
    }
  });

  test('routes opt-in v0 requests to the fixed v0 management prefix preserving deployment subpath and auth', async () => {
    apiClient.setConfig({
      apiBase: 'https://proxy.example.com/custom/path/v8/management',
      managementKey: 'fixture-key-bearer',
    });

    let inspectedConfig: Parameters<AxiosAdapter>[0] | null = null;
    const adapter: AxiosAdapter = async (config) => {
      inspectedConfig = config;
      return { data: { usage: {} }, status: 200, statusText: 'OK', headers: {}, config };
    };

    await apiClient.get('/usage', { useV0Management: true, adapter });
    expect(inspectedConfig).not.toBeNull();
    expect(inspectedConfig!.baseURL).toBe('https://proxy.example.com/custom/path/v0/management');
    expect(inspectedConfig!.headers.Authorization).toBe('Bearer fixture-key-bearer');
  });

  test('derives fixed v0 base when apiBase lacks management prefix', async () => {
    apiClient.setConfig({
      apiBase: 'http://localhost:8317',
      managementKey: 'fixture-key-plain',
    });

    let inspectedConfig: Parameters<AxiosAdapter>[0] | null = null;
    const adapter: AxiosAdapter = async (config) => {
      inspectedConfig = config;
      return { data: { usage: {} }, status: 200, statusText: 'OK', headers: {}, config };
    };

    await apiClient.get('/usage', { useV0Management: true, adapter });
    expect(inspectedConfig).not.toBeNull();
    expect(inspectedConfig!.baseURL).toBe('http://localhost:8317/v0/management');
  });

  test('dispatches server version and plugin support events on successful v0 response', async () => {
    const events: Array<{ type: string; detail: unknown }> = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push({
            type: event.type,
            detail: (event as CustomEvent).detail,
          });
          return true;
        },
      },
    });

    apiClient.setConfig({
      apiBase: 'http://localhost:8317',
      managementKey: 'fixture-key-events',
    });

    const adapter: AxiosAdapter = async (config) => ({
      data: { usage: {} },
      status: 200,
      statusText: 'OK',
      headers: {
        'x-cpa-version': 'v8.0.0',
        'x-cpa-support-plugin': 'false',
      },
      config,
    });

    await apiClient.get('/usage', { useV0Management: true, adapter });
    expect(events.map((e) => e.type)).toEqual([
      'server-version-update',
      'server-plugin-support-update',
    ]);
    expect(events[0].detail).toEqual({ version: 'v8.0.0', buildDate: null });
    expect(events[1].detail).toEqual({ supportsPlugin: false });
  });

  test('normalizes 401 error and dispatches unauthorized event on current connection', async () => {
    const events: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push(event.type);
          return true;
        },
      },
    });

    apiClient.setConfig({
      apiBase: 'http://localhost:8317',
      managementKey: 'fixture-key-invalid',
    });

    const adapter: AxiosAdapter = async (config) => {
      const response = {
        config,
        data: { error: 'Invalid management key' },
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
      };
      throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response);
    };

    let caughtError: unknown;
    try {
      await apiClient.get('/usage', { useV0Management: true, adapter });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect((caughtError as { status?: number }).status).toBe(401);
    expect(events).toContain('unauthorized');
  });

  test('guards against same-tick connection switching before dispatch without sending key or logging out', async () => {
    const events: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push(event.type);
          return true;
        },
      },
    });

    let adapterDispatched = false;
    const adapter: AxiosAdapter = async (config) => {
      adapterDispatched = true;
      return {
        data: { usage: {} },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    // 1. Initial connection A
    apiClient.setConfig({
      apiBase: 'https://server-a.invalid',
      managementKey: 'fixture-key-a',
    });

    // 2. Initiate request on A
    const requestPromise = apiClient.get('/usage', { useV0Management: true, adapter });

    // 3. Switch to connection B in the same tick before dispatch
    apiClient.setConfig({
      apiBase: 'https://server-b.invalid',
      managementKey: 'fixture-key-b',
    });

    // 4. Request must be locally aborted before dispatch
    await expect(requestPromise).rejects.toHaveProperty('code', 'ERR_CANCELED');
    expect(adapterDispatched).toBe(false);
    expect(events).toEqual([]);
  });

  test('guards against ABA connection switching before dispatch', async () => {
    const events: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push(event.type);
          return true;
        },
      },
    });

    let adapterDispatched = false;
    const adapter: AxiosAdapter = async (config) => {
      adapterDispatched = true;
      return {
        data: { added: 1 },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    // A (revision 1)
    apiClient.setConfig({
      apiBase: 'https://server-a.invalid',
      managementKey: 'fixture-key-a',
    });

    // Initiate on A
    const requestPromise = apiClient.post(
      '/usage/import',
      { test: 'aba' },
      { useV0Management: true, adapter }
    );

    // Switch A -> B -> A in same tick
    apiClient.setConfig({
      apiBase: 'https://server-b.invalid',
      managementKey: 'fixture-key-b',
    });
    apiClient.setConfig({
      apiBase: 'https://server-a.invalid',
      managementKey: 'fixture-key-a',
    });

    // Must still abort because connectionRevision incremented
    await expect(requestPromise).rejects.toHaveProperty('code', 'ERR_CANCELED');
    expect(adapterDispatched).toBe(false);
    expect(events).toEqual([]);
  });

  test('cancels delayed successful response after connection switch A -> B without dispatching events', async () => {
    const events: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push(event.type);
          return true;
        },
      },
    });

    apiClient.setConfig({
      apiBase: 'https://server-a.invalid',
      managementKey: 'fixture-key-a',
    });

    let deliver!: () => void;
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });

    const requestPromise = apiClient.get('/usage', {
      useV0Management: true,
      adapter: (config) =>
        new Promise<AxiosResponse>((resolve) => {
          deliver = () => {
            resolve({
              data: { usage: { apis: { server: 'A' } } },
              status: 200,
              statusText: 'OK',
              headers: { 'x-cpa-version': 'v8.0.0', 'x-cpa-support-plugin': 'true' },
              config,
            });
          };
          startedResolve();
        }),
    });

    await started;

    // Switch connection to B while request A is in-flight
    apiClient.setConfig({
      apiBase: 'https://server-b.invalid',
      managementKey: 'fixture-key-b',
    });

    // Deliver response from server A
    deliver();

    await expect(requestPromise).rejects.toHaveProperty('code', 'ERR_CANCELED');
    expect(events).toEqual([]);
  });

  test('cancels delayed successful response after connection switch A -> B -> A without dispatching events', async () => {
    const events: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push(event.type);
          return true;
        },
      },
    });

    apiClient.setConfig({
      apiBase: 'https://server-a.invalid',
      managementKey: 'fixture-key-a',
    });

    let deliver!: () => void;
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });

    const requestPromise = apiClient.get('/usage', {
      useV0Management: true,
      adapter: (config) =>
        new Promise<AxiosResponse>((resolve) => {
          deliver = () => {
            resolve({
              data: { usage: { apis: { server: 'A' } } },
              status: 200,
              statusText: 'OK',
              headers: { 'x-cpa-version': 'v8.0.0', 'x-cpa-support-plugin': 'true' },
              config,
            });
          };
          startedResolve();
        }),
    });

    await started;

    // Switch connection A -> B -> A
    apiClient.setConfig({
      apiBase: 'https://server-b.invalid',
      managementKey: 'fixture-key-b',
    });
    apiClient.setConfig({
      apiBase: 'https://server-a.invalid',
      managementKey: 'fixture-key-a',
    });

    // Deliver delayed response from the original server A request
    deliver();

    await expect(requestPromise).rejects.toHaveProperty('code', 'ERR_CANCELED');
    expect(events).toEqual([]);
  });

  test('suppresses unauthorized event when 401 arrives from a stale connection after switch A -> B', async () => {
    const events: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push(event.type);
          return true;
        },
      },
    });

    apiClient.setConfig({
      apiBase: 'https://server-a.invalid',
      managementKey: 'fixture-key-a',
    });

    let deliver!: () => void;
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });

    const requestPromise = apiClient.get('/usage', {
      useV0Management: true,
      adapter: (config) =>
        new Promise<AxiosResponse>((_resolve, reject) => {
          deliver = () => {
            const response: AxiosResponse = {
              data: { error: 'Invalid management key' },
              status: 401,
              statusText: 'Unauthorized',
              headers: {},
              config,
            };
            reject(new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response));
          };
          startedResolve();
        }),
    });

    await started;

    // Switch connection to B while request A is in-flight
    apiClient.setConfig({
      apiBase: 'https://server-b.invalid',
      managementKey: 'fixture-key-b',
    });

    // Deliver 401 response from server A
    deliver();

    let caughtError: unknown;
    try {
      await requestPromise;
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect((caughtError as { status?: number }).status).toBe(401);
    expect(events).toEqual([]);
  });

  test('centralizes connectionRevision in prepareConfig and ignores caller-supplied revision', async () => {
    apiClient.setConfig({
      apiBase: 'https://server-a.invalid',
      managementKey: 'fixture-key-a',
    });

    let inspectedConfig: Parameters<AxiosAdapter>[0] | null = null;
    const adapter: AxiosAdapter = async (config) => {
      inspectedConfig = config;
      return { data: { usage: {} }, status: 200, statusText: 'OK', headers: {}, config };
    };

    // Caller attempts to override connectionRevision
    await apiClient.get('/usage', {
      useV0Management: true,
      connectionRevision: 999,
      adapter,
    });

    expect(inspectedConfig).not.toBeNull();
    // Must be the actual apiClient connection revision (1), not caller-supplied 999
    expect(inspectedConfig!.connectionRevision).toBe(apiClient.getConnectionRevision());
  });

  test('never accepts arbitrary host overrides in custom options', async () => {
    apiClient.setConfig({
      apiBase: 'https://proxy.example.com/custom/path',
      managementKey: 'fixture-key',
    });

    let capturedBaseURL: string | undefined;
    const adapter: AxiosAdapter = async (config) => {
      capturedBaseURL = config.baseURL;
      return { data: { usage: {} }, status: 200, statusText: 'OK', headers: {}, config };
    };

    await apiClient.get('/usage', {
      useV0Management: true,
      baseURL: 'https://evil.invalid',
      adapter,
    } as Parameters<typeof apiClient.get>[1]);

    expect(capturedBaseURL).toBe('https://proxy.example.com/custom/path/v0/management');
  });
});
