export const BOOKMARK_CHECK_BATCH_SIZE = 100;

export function bookmarkCheckBatches(urns: string[]): string[][] {
  const uniqueUrns = [...new Set(urns.filter(Boolean))];
  const batches: string[][] = [];
  for (let index = 0; index < uniqueUrns.length; index += BOOKMARK_CHECK_BATCH_SIZE) {
    batches.push(uniqueUrns.slice(index, index + BOOKMARK_CHECK_BATCH_SIZE));
  }
  return batches;
}

export function bookmarkUrnsNeedingCheck(
  urns: string[],
  checkedUrns: Record<string, boolean>,
  checkingUrns: Record<string, boolean>,
): string[] {
  return [...new Set(urns.filter(Boolean))]
    .filter((urn) => !checkedUrns[urn] && !checkingUrns[urn])
    .sort();
}
