import { describe, expect, test } from 'bun:test';
import { createRequestGate } from '../src/utils/requestGate';

describe('request gate', () => {
  test('accepts only the latest request for each key', () => {
    const gate = createRequestGate();
    const firstA = gate.begin('a');
    const currentB = gate.begin('b');
    const currentA = gate.begin('a');

    expect(gate.isCurrent(firstA)).toBe(false);
    expect(gate.isCurrent(currentA)).toBe(true);
    expect(gate.isCurrent(currentB)).toBe(true);
  });

  test('invalidates one key without disturbing another', () => {
    const gate = createRequestGate();
    const requestA = gate.begin('a');
    const requestB = gate.begin('b');

    gate.invalidate('a');

    expect(gate.isCurrent(requestA)).toBe(false);
    expect(gate.isCurrent(requestB)).toBe(true);
  });

  test('invalidates every outstanding request', () => {
    const gate = createRequestGate();
    const requestA = gate.begin('a');
    const requestB = gate.begin('b');

    gate.invalidateAll();

    expect(gate.isCurrent(requestA)).toBe(false);
    expect(gate.isCurrent(requestB)).toBe(false);
  });
});
