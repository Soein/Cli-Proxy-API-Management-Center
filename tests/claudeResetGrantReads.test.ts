import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  createResetGrantReader,
  scheduleResetGrantRead,
  RESET_GRANT_READ_DELAY_MS,
} from '../src/features/quota/providers/claude/resetGrantReads';
import { useQuotaStore } from '../src/stores/useQuotaStore';
import type { AnthropicResetGrantStatus } from '../src/services/api/claudeResetGrants';

const status: AnthropicResetGrantStatus = {
  eligible: false,
  ineligibleReason: null,
  atLimit: false,
  grants: [],
  nextGrantId: null,
  weeklyResetsAt: null,
  cooldownUntil: null,
};
const deferred = () => {
  let resolve!: (value: AnthropicResetGrantStatus) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<AnthropicResetGrantStatus>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  useQuotaStore.getState().clearQuotaCache();
});

afterEach(() => {
  useQuotaStore.getState().clearQuotaCache();
});

test('waits 2000ms; cleanup cancels and stale sessions cannot dispatch', async () => {
  expect(RESET_GRANT_READ_DELAY_MS).toBe(2000);
  let reads = 0;
  let session = 1;
  const start = () => {
    reads += 1;
  };
  const cancel = scheduleResetGrantRead(start, () => true);
  const cancelStale = scheduleResetGrantRead(start, () => session === 1);
  const cancelActive = scheduleResetGrantRead(start, () => true);
  try {
    expect(reads).toBe(0);
    cancel(); // Effect cleanup: refresh, unmount, or connection change.
    session = 2; // Also guard a connection change before React cleanup runs.
    await Bun.sleep(1900);
    expect(reads).toBe(0);
    await Bun.sleep(200);
    expect(reads).toBe(1);
    await Bun.sleep(100);
    expect(reads).toBe(1);
  } finally {
    cancel();
    cancelStale();
    cancelActive();
  }
});

test('shares concurrent credential reads only within a session and never caches results', async () => {
  let revision = 1;
  const requests: ReturnType<typeof deferred>[] = [];
  const read = createResetGrantReader({
    revision: () => revision,
    read: () => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
  });
  const old = read('claude.json', 'a');
  expect(read('claude.json', 'a') === old).toBe(true);
  const other = read('claude.json', 'b');
  expect(requests).toHaveLength(2);
  revision = 2;
  const fresh = read('claude.json', 'a');
  expect(fresh === old).toBe(false);
  const staleResult = old.catch((error: unknown) => error);
  requests[0].resolve(status);
  expect(await staleResult).toMatchObject({ message: 'session' });
  expect(read('claude.json', 'a') === fresh).toBe(true); // Old cleanup must not delete the new session read.
  const otherResult = other.catch((error: unknown) => error);
  requests[1].resolve(status);
  expect(await otherResult).toMatchObject({ message: 'session' });
  requests[2].resolve(status);
  expect(await fresh).toBe(status);
  const next = read('claude.json', 'a');
  expect(requests).toHaveLength(4);
  requests[3].resolve(status);
  await next;
});

test('failed reads are released without automatic retry', async () => {
  let calls = 0;
  const read = createResetGrantReader({
    revision: () => 1,
    read: async () => {
      calls += 1;
      throw new Error('rate limited');
    },
  });
  await expect(read('claude.json', 'a')).rejects.toThrow('rate limited');
  expect(calls).toBe(1);
  await expect(read('claude.json', 'a')).rejects.toThrow('rate limited');
  expect(calls).toBe(2);
});

test('same-name replacement with stable authIndex and revision starts fresh request and rejects old response', async () => {
  const requests: ReturnType<typeof deferred>[] = [];
  const read = createResetGrantReader({
    revision: () => 1,
    read: () => {
      const req = deferred();
      requests.push(req);
      return req.promise;
    },
  });

  const old = read('claude.json', 'auth-1');
  expect(requests).toHaveLength(1);

  // Invalidate same-name auth file via real quota store
  useQuotaStore.getState().clearQuotaCache(['claude.json']);

  // Same authIndex and revision, but same-name file replacement must trigger fresh request
  const fresh = read('claude.json', 'auth-1');
  expect(requests).toHaveLength(2);
  expect(fresh === old).toBe(false);

  // Old in-flight read resolves late, but must be rejected because file was invalidated
  const oldErrorPromise = old.catch((err: unknown) => err);
  requests[0].resolve(status);
  const oldError = await oldErrorPromise;
  expect(oldError).toMatchObject({ message: 'stale' });

  // Fresh in-flight read resolves successfully with new result
  requests[1].resolve(status);
  expect(await fresh).toBe(status);
});

test('old-finally cannot remove fresh in-flight request', async () => {
  const requests: ReturnType<typeof deferred>[] = [];
  const read = createResetGrantReader({
    revision: () => 1,
    read: () => {
      const req = deferred();
      requests.push(req);
      return req.promise;
    },
  });

  const old = read('claude.json', 'auth-1');
  expect(requests).toHaveLength(1);

  // Invalidate same file
  useQuotaStore.getState().clearQuotaCache(['claude.json']);

  // Dispatch fresh read for the replacement
  const fresh = read('claude.json', 'auth-1');
  expect(requests).toHaveLength(2);

  // Old request settles first and runs its finally block
  requests[0].resolve(status);
  await old.catch(() => {});

  // A concurrent read for the current credential must STILL share the fresh in-flight request,
  // proving that old's finally did not remove fresh from inFlight
  expect(read('claude.json', 'auth-1')).toBe(fresh);
  expect(requests).toHaveLength(2);

  // Now settle fresh request
  requests[1].resolve(status);
  expect(await fresh).toBe(status);

  // Once fresh settles, in-flight entry is cleaned up (no result caching)
  const afterSettled = read('claude.json', 'auth-1');
  expect(requests).toHaveLength(3);
  requests[2].resolve(status);
  await afterSettled;
});

test('unrelated-file clear retains sharing', async () => {
  const requests: ReturnType<typeof deferred>[] = [];
  const read = createResetGrantReader({
    revision: () => 1,
    read: () => {
      const req = deferred();
      requests.push(req);
      return req.promise;
    },
  });

  const target = read('claude-1.json', 'auth-1');
  expect(requests).toHaveLength(1);

  // Invalidate an unrelated auth file
  useQuotaStore.getState().clearQuotaCache(['claude-2.json']);

  // Target file read is still valid and sharing is retained
  expect(read('claude-1.json', 'auth-1')).toBe(target);
  expect(requests).toHaveLength(1);

  // Target resolves successfully without rejection
  requests[0].resolve(status);
  expect(await target).toBe(status);
});

test('full cache clear invalidates in-flight read and starts fresh request', async () => {
  const requests: ReturnType<typeof deferred>[] = [];
  const read = createResetGrantReader({
    revision: () => 1,
    read: () => {
      const req = deferred();
      requests.push(req);
      return req.promise;
    },
  });

  const old = read('claude.json', 'auth-1');
  expect(requests).toHaveLength(1);

  // Global cache clear
  useQuotaStore.getState().clearQuotaCache();

  // Next read must start fresh
  const fresh = read('claude.json', 'auth-1');
  expect(requests).toHaveLength(2);
  expect(fresh === old).toBe(false);

  // Old request resolves late and gets rejected
  const oldErrorPromise = old.catch((err: unknown) => err);
  requests[0].resolve(status);
  const oldError = await oldErrorPromise;
  expect(oldError).toMatchObject({ message: 'stale' });

  // Fresh request resolves successfully
  requests[1].resolve(status);
  expect(await fresh).toBe(status);
});
