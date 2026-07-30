export type RequestToken = {
  key: string;
  version: number;
  epoch: number;
};

export type RequestGate = {
  begin: (key: string) => RequestToken;
  isCurrent: (token: RequestToken) => boolean;
  invalidate: (key: string) => void;
  invalidateAll: () => void;
};

export const createRequestGate = (): RequestGate => {
  const versions = new Map<string, number>();
  let epoch = 0;

  return {
    begin(key) {
      const version = (versions.get(key) ?? 0) + 1;
      versions.set(key, version);
      return { key, version, epoch };
    },
    isCurrent(token) {
      return token.epoch === epoch && versions.get(token.key) === token.version;
    },
    invalidate(key) {
      versions.set(key, (versions.get(key) ?? 0) + 1);
    },
    invalidateAll() {
      epoch += 1;
      versions.clear();
    },
  };
};
