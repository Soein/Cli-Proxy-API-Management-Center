import { afterEach, describe, expect, test } from 'bun:test';
import { AxiosError, type AxiosAdapter } from 'axios';
import { apiClient } from '../src/services/api/client';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('captured mutation transport also suppresses events when its session expires on the same connection', async () => {
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
  apiClient.setConfig({ apiBase: 'https://proxy.invalid', managementKey: 'fixture-only' });
  let current = true;
  const captured = apiClient.captureConnection(() => current);
  current = false;
  const adapter: AxiosAdapter = async (config) => ({
    data: {},
    status: 200,
    statusText: 'OK',
    config,
    headers: { 'x-cpa-version': 'stale', 'x-cpa-support-plugin': 'true' },
  });
  await captured.post('/requests/api-call', {}, { adapter });
  const unauthorized: AxiosAdapter = async (config) => {
    throw { isAxiosError: true, message: 'Unauthorized', config, response: { status: 401 } };
  };
  await expect(
    captured.post('/requests/api-call', {}, { adapter: unauthorized })
  ).rejects.toThrow();
  expect(events).toEqual([]);
});

test('captured mutation transport preserves the configured timeout', async () => {
  apiClient.setConfig({
    apiBase: 'https://proxy.invalid',
    managementKey: 'fixture-only',
    timeout: 45000,
  });
  const captured = apiClient.captureConnection();
  const adapter: AxiosAdapter = async (config) => {
    expect(config.timeout).toBe(45000);
    return { data: {}, status: 200, statusText: 'OK', config, headers: {} };
  };
  await captured.post('/requests/api-call', {}, { adapter });
});

test.each(['active', 'connection changed', 'parent expired', 'child expired'] as const)(
  'nested captured transport retains event ownership when %s',
  async (ownership) => {
    const events: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { dispatchEvent: (event: Event) => events.push(event.type) },
    });
    apiClient.setConfig({ apiBase: 'https://original.invalid', managementKey: 'original-fixture' });
    let parentCurrent = true;
    let childCurrent = true;
    const captured = apiClient
      .captureConnection(() => parentCurrent)
      .captureConnection(() => childCurrent);
    const adapter: AxiosAdapter = async (config) => {
      expect(config.baseURL).toBe('https://original.invalid/v8/management');
      expect(config.headers.Authorization).toBe('Bearer original-fixture');
      if (ownership === 'connection changed') {
        apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'new-fixture' });
      }
      if (ownership === 'parent expired') parentCurrent = false;
      if (ownership === 'child expired') childCurrent = false;
      return {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        config,
        headers: { 'x-cpa-version': 'fixture', 'x-cpa-support-plugin': 'true' },
      };
    };
    await expect(captured.post('/requests/api-call', {}, { adapter })).resolves.toEqual({
      ok: true,
    });
    const unauthorized: AxiosAdapter = async (config) => {
      throw { isAxiosError: true, message: 'Unauthorized', config, response: { status: 401 } };
    };
    await expect(
      captured.post('/requests/api-call', {}, { adapter: unauthorized })
    ).rejects.toThrow();
    expect(events).toEqual(
      ownership === 'active'
        ? ['server-version-update', 'server-plugin-support-update', 'unauthorized']
        : []
    );
  }
);

describe('v8 management transport', () => {
  test('uses the v8 prefix, bearer authentication and bare JSON scalar writes', async () => {
    apiClient.setConfig({
      apiBase: 'https://proxy.invalid/gateway/v8/management',
      managementKey: 'fixture-only',
    });
    const adapter: AxiosAdapter = async (config) => {
      expect(config.baseURL).toBe('https://proxy.invalid/gateway/v8/management');
      expect(config.url).toBe('/config/observability/logs/debug');
      expect(config.headers.Authorization).toBe('Bearer fixture-only');
      expect(config.data).toBe('false');
      return { data: { status: 'ok' }, status: 200, statusText: 'OK', headers: {}, config };
    };
    await apiClient.put('/config/observability/logs/debug', false, { adapter });
  });

  test('retains backend version and plugin support events', async () => {
    const events: Event[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push(event);
          return true;
        },
      },
    });
    apiClient.setConfig({ apiBase: 'http://proxy.invalid', managementKey: 'fixture-only' });
    const adapter: AxiosAdapter = async (config) => ({
      data: {},
      status: 200,
      statusText: 'OK',
      config,
      headers: { 'x-cpa-version': 'v8.0.3', 'x-cpa-support-plugin': 'true' },
    });
    await apiClient.get('/config', { adapter });
    expect(events.map((event) => event.type)).toEqual([
      'server-version-update',
      'server-plugin-support-update',
    ]);
    expect((events[0] as CustomEvent).detail.version).toBe('v8.0.3');
    expect((events[1] as CustomEvent).detail.supportsPlugin).toBe(true);
  });
});

test('captured SIWC transport keeps original credentials and suppresses stale events, including ABA', async () => {
  const events: Event[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        events.push(event);
        return true;
      },
    },
  });
  apiClient.setConfig({ apiBase: 'https://original.invalid', managementKey: 'original-fixture' });
  const captured = apiClient.captureConnection();
  apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'new-fixture' });
  const adapter: AxiosAdapter = async (config) => {
    expect(config.baseURL).toBe('https://original.invalid/v8/management');
    expect(config.headers.Authorization).toBe('Bearer original-fixture');
    return {
      data: {},
      status: 200,
      statusText: 'OK',
      config,
      headers: { 'x-cpa-version': 'old', 'x-cpa-support-plugin': 'true' },
    };
  };
  await captured.delete('/oauth/session', { params: { state: 'original-session' }, adapter });
  apiClient.setConfig({ apiBase: 'https://original.invalid', managementKey: 'original-fixture' });
  await captured.delete('/oauth/session', { params: { state: 'original-session' }, adapter });
  expect(events).toEqual([]);
  const unauthorized: AxiosAdapter = async (config) => {
    throw { isAxiosError: true, message: 'Unauthorized', config, response: { status: 401 } };
  };
  await expect(captured.delete('/oauth/session', { adapter: unauthorized })).rejects.toThrow();
  expect(events).toEqual([]);
});

test('ordinary v8 writes abort if the connection changes before dispatch, including ABA', async () => {
  apiClient.setConfig({ apiBase: 'https://original.invalid', managementKey: 'original-fixture' });
  let dispatched = false;
  const adapter: AxiosAdapter = async (config) => {
    dispatched = true;
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  const request = apiClient.patch('/config', { routing: { strategy: 'fill-first' } }, { adapter });
  apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'new-fixture' });
  apiClient.setConfig({ apiBase: 'https://original.invalid', managementKey: 'original-fixture' });

  await expect(request).rejects.toHaveProperty('code', 'ERR_CANCELED');
  expect(dispatched).toBe(false);
});

test.each([200, 401])(
  'ordinary stale v8 responses (%s) do not dispatch session events',
  async (status) => {
    const events: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { dispatchEvent: (event: Event) => events.push(event.type) },
    });
    apiClient.setConfig({ apiBase: 'https://original.invalid', managementKey: 'original-fixture' });
    const adapter: AxiosAdapter = async (config) => {
      apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'new-fixture' });
      const response = {
        data: {},
        status,
        statusText: status === 200 ? 'OK' : 'Unauthorized',
        headers: { 'x-cpa-version': 'stale', 'x-cpa-support-plugin': 'true' },
        config,
      };
      if (status === 401)
        throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, response);
      return response;
    };

    await expect(apiClient.get('/config', { adapter })).rejects.toThrow();
    expect(events).toEqual([]);
  }
);

test('captured connections preserve extension URL, timeout and caller cancellation signal', async () => {
  apiClient.setConfig({
    apiBase: 'https://original.invalid/gateway',
    managementKey: 'original-fixture',
    timeout: 12345,
  });
  const captured = apiClient.captureConnection();
  const controller = new AbortController();
  apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'new-fixture' });
  const adapter: AxiosAdapter = async (config) => {
    expect(config.baseURL).toBe('https://original.invalid/gateway/v0/management');
    expect(config.headers.Authorization).toBe('Bearer original-fixture');
    expect(config.timeout).toBe(12345);
    expect(config.signal).toBe(controller.signal);
    return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
  };
  await expect(
    captured.get('/usage', { useV0Management: true, signal: controller.signal, adapter })
  ).resolves.toEqual({ ok: true });
});
