import { describe, expect, test } from 'bun:test';
import { createQuotaResetGuard } from '../src/features/quota/resetGuard';

describe('quota reset guard', () => {
  test('tracks different credentials independently', () => {
    const guard = createQuotaResetGuard();

    expect(guard.tryBegin('codex-a.json')).toBe(true);
    expect(guard.tryBegin('codex-b.json')).toBe(true);
    expect([...guard.snapshot()]).toEqual(['codex-a.json', 'codex-b.json']);
  });

  test('blocks a duplicate reset until that credential finishes', () => {
    const guard = createQuotaResetGuard();

    expect(guard.tryBegin('codex-a.json')).toBe(true);
    expect(guard.tryBegin('codex-a.json')).toBe(false);

    guard.finish('codex-a.json');

    expect(guard.tryBegin('codex-a.json')).toBe(true);
  });

  test('finishing one credential leaves other resets active', () => {
    const guard = createQuotaResetGuard();
    guard.tryBegin('codex-a.json');
    guard.tryBegin('codex-b.json');

    guard.finish('codex-a.json');

    expect(guard.isActive('codex-a.json')).toBe(false);
    expect(guard.isActive('codex-b.json')).toBe(true);
  });
});
