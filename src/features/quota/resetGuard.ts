/** Per-credential mutual exclusion for quota reset operations. */
export type QuotaResetGuard = {
  tryBegin: (name: string) => boolean;
  finish: (name: string) => void;
  isActive: (name: string) => boolean;
  snapshot: () => ReadonlySet<string>;
};

export const createQuotaResetGuard = (): QuotaResetGuard => {
  const activeNames = new Set<string>();

  return {
    tryBegin(name) {
      if (activeNames.has(name)) return false;
      activeNames.add(name);
      return true;
    },
    finish(name) {
      activeNames.delete(name);
    },
    isActive(name) {
      return activeNames.has(name);
    },
    snapshot() {
      return new Set(activeNames);
    },
  };
};
