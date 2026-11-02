import { describe, expect, test } from 'bun:test';
import {
  parseAnthropicResetGrantStatus,
  type AnthropicResetSettledCode,
} from '../src/services/api/claudeResetGrants';
import type { AuthFileCooldownResetResponse } from '../src/services/api/authFiles';
import {
  createResetGrantOperations,
  type ResetGrantGuard,
} from '../src/features/quota/providers/claude/resetGrantOperations';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '../src/stores/useQuotaStore';

const organization = '11111111-2222-3333-4444-555555555555';
const grant = { id: 'test-grant', resets_total: 2, resets_left: 2, usable_now: true };
const block = { eligible: true, at_limit: true, grants: [grant] };
const status = () => parseAnthropicResetGrantStatus(block)!;

function setup() {
  let revision = 1;
  const now = 1000;
  let count = 0;
  const ids: string[] = [];
  const cleared: string[] = [];
  let claimResolver: ((code: AnthropicResetSettledCode) => void) | null = null;
  let claimRejecter: ((error: unknown) => void) | null = null;
  let claimCalled = false;

  const deps = {
    revision: () => revision,
    now: () => now,
    requestId: () => `request-${++count}`,
    readStatus: async () => status(),
    readOrganization: async () => organization,
    resetCooldown: async (authIndex: string): Promise<AuthFileCooldownResetResponse> => {
      cleared.push(authIndex);
      return { status: 'ok', auth_index: authIndex, models: [] };
    },
    claim: async (
      _auth: string,
      _org: string,
      _grant: string,
      id: string
    ): Promise<AnthropicResetSettledCode> => {
      claimCalled = true;
      ids.push(id);
      return new Promise<AnthropicResetSettledCode>((resolve, reject) => {
        claimResolver = resolve;
        claimRejecter = reject;
      });
    },
  };

  return {
    deps,
    ids,
    cleared,
    wasClaimCalled: () => claimCalled,
    settleClaim: (code: AnthropicResetSettledCode) => {
      if (!claimResolver) throw new Error('Claim was not called yet');
      claimResolver(code);
    },
    failClaim: (error: unknown) => {
      if (!claimRejecter) throw new Error('Claim was not called yet');
      claimRejecter(error);
    },
    nextSession: () => {
      revision += 1;
    },
  };
}

describe('Claude reset grant concurrency and replacement credential isolation', () => {
  for (const code of ['reset', 'already_used'] as const) {
    test(`invalidating same file while claim is in flight prevents clearing cooldown on ${code} and leaves journal settled`, async () => {
      useQuotaStore.getState().clearQuotaCache();
      const h = setup();
      const operations = createResetGrantOperations(h.deps);

      const fileName = 'auth-target.json';
      const authIndex = 'claude:auth/auth-target.json';
      const snapshot = captureQuotaCacheGeneration(fileName);
      const guard: ResetGrantGuard = () => commitIfQuotaCacheCurrent(snapshot, () => {}, fileName);

      const runPromise = operations.run('account-1', authIndex, grant.id, guard);
      // Wait for event loop tick so preflight completes and claim is in flight
      await new Promise((r) => setTimeout(r, 10));

      expect(h.wasClaimCalled()).toBe(true);
      expect(h.cleared).toEqual([]);

      // Invalidate the exact same file (simulating replacement upload)
      useQuotaStore.getState().clearQuotaCache([fileName]);

      // Claim settles upstream
      h.settleClaim(code);
      const result = await runPromise;

      // Settlement is recorded, but cooldown clear was refused for the invalidated credential
      expect(result).toEqual({ code, unresolved: false });
      expect(h.cleared).toEqual([]);
      expect(operations.inspect('account-1')?.code).toBe(code);
    });
  }

  test('invalidating unrelated file while claim is in flight allows clearing cooldown', async () => {
    useQuotaStore.getState().clearQuotaCache();
    const h = setup();
    const operations = createResetGrantOperations(h.deps);

    const fileName = 'auth-target.json';
    const authIndex = 'claude:auth/auth-target.json';
    const snapshot = captureQuotaCacheGeneration(fileName);
    const guard: ResetGrantGuard = () => commitIfQuotaCacheCurrent(snapshot, () => {}, fileName);

    const runPromise = operations.run('account-2', authIndex, grant.id, guard);
    await new Promise((r) => setTimeout(r, 10));

    // Invalidate an unrelated file
    useQuotaStore.getState().clearQuotaCache(['other-unrelated.json']);

    h.settleClaim('reset');
    const result = await runPromise;

    expect(result).toEqual({ code: 'reset', unresolved: false });
    expect(h.cleared).toEqual([authIndex]);
    expect(operations.inspect('account-2')?.code).toBe('reset');
  });

  test('unchanged file allows clearing cooldown upon settlement', async () => {
    useQuotaStore.getState().clearQuotaCache();
    const h = setup();
    const operations = createResetGrantOperations(h.deps);

    const fileName = 'auth-target.json';
    const authIndex = 'claude:auth/auth-target.json';
    const snapshot = captureQuotaCacheGeneration(fileName);
    const guard: ResetGrantGuard = () => commitIfQuotaCacheCurrent(snapshot, () => {}, fileName);

    const runPromise = operations.run('account-3', authIndex, grant.id, guard);
    await new Promise((r) => setTimeout(r, 10));

    h.settleClaim('reset');
    const result = await runPromise;

    expect(result).toEqual({ code: 'reset', unresolved: false });
    expect(h.cleared).toEqual([authIndex]);
    expect(operations.inspect('account-3')?.code).toBe('reset');
  });

  test('connection change while claim is in flight cancels cooldown clear and isolates session', async () => {
    const h = setup();
    const operations = createResetGrantOperations(h.deps);

    const fileName = 'auth-target.json';
    const authIndex = 'claude:auth/auth-target.json';
    const snapshot = captureQuotaCacheGeneration(fileName);
    const guard: ResetGrantGuard = () => commitIfQuotaCacheCurrent(snapshot, () => {}, fileName);

    const runPromise = operations.run('account-4', authIndex, grant.id, guard);
    await new Promise((r) => setTimeout(r, 10));

    // Connection changes before claim settles
    h.nextSession();
    h.settleClaim('reset');

    await expect(runPromise).rejects.toThrow('session');
    expect(h.cleared).toEqual([]);
    expect(operations.inspect('account-4')).toBeUndefined();
  });

  test('invalidating file before preflight completes rejects early and avoids claim dispatch', async () => {
    useQuotaStore.getState().clearQuotaCache();
    const h = setup();
    const operations = createResetGrantOperations(h.deps);

    const fileName = 'auth-target.json';
    const authIndex = 'claude:auth/auth-target.json';
    const snapshot = captureQuotaCacheGeneration(fileName);
    const guard: ResetGrantGuard = () => commitIfQuotaCacheCurrent(snapshot, () => {}, fileName);

    // Invalidate immediately before run
    useQuotaStore.getState().clearQuotaCache([fileName]);

    await expect(operations.run('account-5', authIndex, grant.id, guard)).rejects.toThrow(
      'identity'
    );
    expect(h.wasClaimCalled()).toBe(false);
    expect(h.cleared).toEqual([]);
  });

  test('ClaudeResetGrants component provides isCredentialCurrent guard to resetGrantOperations.run', async () => {
    const hook = await Bun.file('src/features/quota/providers/claude/ClaudeResetGrants.tsx').text();
    expect(hook).toContain('isCredentialCurrent');
    expect(hook).toContain('resetGrantOperations.run(');
    expect(hook).toContain('isCredentialCurrent');
    // Ensure ordinary unmount generation is decoupled from credential identity
    expect(hook).toContain('const isCredentialCurrent = () =>');
    expect(hook).toContain('commitIfQuotaCacheCurrent(cacheSnapshot, () => {}, file.name)');
  });
});
