import { describe, expect, test } from 'bun:test';
import { reconcileBatchDownloadSelection } from '../src/features/authFiles/batchDownload';

describe('batch download selection', () => {
  test('removes successful downloads and keeps failed names selected', () => {
    const next = reconcileBatchDownloadSelection(
      ['success.json', 'failed.json'],
      ['success.json', 'failed.json'],
      ['failed.json']
    );

    expect(Array.from(next)).toEqual(['failed.json']);
  });

  test('preserves selections added while the batch was running', () => {
    const next = reconcileBatchDownloadSelection(
      ['requested.json', 'new-selection.json'],
      ['requested.json'],
      []
    );

    expect(Array.from(next)).toEqual(['new-selection.json']);
  });
});
