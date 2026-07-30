export const reconcileBatchDownloadSelection = (
  currentSelection: Iterable<string>,
  requestedNames: Iterable<string>,
  failedNames: Iterable<string>
): Set<string> => {
  const requested = new Set(requestedNames);
  const next = new Set(Array.from(currentSelection).filter((name) => !requested.has(name)));
  Array.from(failedNames).forEach((name) => next.add(name));
  return next;
};
