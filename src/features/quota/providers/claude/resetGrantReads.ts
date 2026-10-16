import { apiClient } from '@/services/api/client';
import { readClaudeResetGrants } from '@/services/api/claudeResetGrants';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';

export const RESET_GRANT_READ_DELAY_MS = 2000;

/** One delayed attempt per effect activation, never an automatic retry. */
export function scheduleResetGrantRead(start: () => void, current: () => boolean) {
  const timeout = setTimeout(() => {
    if (current()) start();
  }, RESET_GRANT_READ_DELAY_MS);
  return () => clearTimeout(timeout);
}

export interface ResetGrantReaderDeps {
  revision?: () => number;
  read?: typeof readClaudeResetGrants;
  captureGeneration?: typeof captureQuotaCacheGeneration;
  commitIfCurrent?: typeof commitIfQuotaCacheCurrent;
}

/** Only card reads are shared. Spending still performs its own fresh preflight reads. */
export function createResetGrantReader(deps: ResetGrantReaderDeps = {}) {
  const revisionFn = deps.revision ?? (() => apiClient.getConnectionRevision());
  const readFn = deps.read ?? readClaudeResetGrants;
  const captureGenerationFn = deps.captureGeneration ?? captureQuotaCacheGeneration;
  const commitIfCurrentFn = deps.commitIfCurrent ?? commitIfQuotaCacheCurrent;

  let session = revisionFn();
  const inFlight = new Map<
    string,
    {
      generation: ReturnType<typeof captureQuotaCacheGeneration>;
      request: ReturnType<typeof readClaudeResetGrants>;
    }
  >();

  return (name: string, authIndex: string = name) => {
    const revision = revisionFn();
    if (revision !== session) {
      session = revision;
      inFlight.clear();
    }

    const key = JSON.stringify([name, authIndex]);
    const existing = inFlight.get(key);
    if (existing) {
      if (commitIfCurrentFn(existing.generation, () => {}, name)) {
        return existing.request;
      }
      inFlight.delete(key);
    }

    const generation = captureGenerationFn(name);
    const request = readFn(authIndex)
      .then((result) => {
        if (revisionFn() !== revision) throw new Error('session');
        if (!commitIfCurrentFn(generation, () => {}, name)) throw new Error('stale');
        return result;
      })
      .finally(() => {
        if (inFlight.get(key)?.request === request) {
          inFlight.delete(key);
        }
      });

    inFlight.set(key, { generation, request });
    return request;
  };
}

export const readResetGrantsForCard = createResetGrantReader();
