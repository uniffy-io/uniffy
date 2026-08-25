/** URL-synced content-type filtering for the Library Tags surface. */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { emptyCriteria, type SerializedTagFilterCriteria } from "@/features/tags/store/tagsThunks";

const splitCsv = (value: string | null): string[] =>
  value ? value.split(",").filter(Boolean) : [];

const DOMAIN_TO_CONTENT_TYPE: Record<string, ContentType> = {
  note: ContentType.NOTE,
  file: ContentType.FILE,
  event: ContentType.CALENDAR_EVENT,
  calendar: ContentType.CALENDAR_EVENT,
  calendar_event: ContentType.CALENDAR_EVENT,
  chat: ContentType.CHAT,
  channel: ContentType.CHAT,
  agent: ContentType.AGENT,
  project: ContentType.PROJECT,
  task: ContentType.TASK,
};

const UNSUPPORTED_LIBRARY_TAG_PARAMS = [
  "tags",
  "owners",
  "sources",
  "createdAfter",
  "createdBefore",
  "updatedAfter",
  "updatedBefore",
  "access",
  "untagged",
] as const;

function contentTypesFromParams(params: URLSearchParams): ContentType[] {
  let types = splitCsv(params.get("types"))
    .map((v) => Number.parseInt(v, 10))
    .filter((n): n is ContentType => Number.isFinite(n));
  if (types.length === 0) {
    const domainTypes = splitCsv(params.get("domain"))
      .map((d) => DOMAIN_TO_CONTENT_TYPE[d.toLowerCase()])
      .filter((t): t is ContentType => t !== undefined);
    if (domainTypes.length > 0) types = domainTypes;
  }
  return types;
}

export function readLibraryTagFilterCriteria(params: URLSearchParams): SerializedTagFilterCriteria {
  return {
    ...emptyCriteria(),
    contentTypes: contentTypesFromParams(params),
  };
}

export function sanitizeLibraryTagFilterParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  const contentTypes = contentTypesFromParams(params);

  for (const key of UNSUPPORTED_LIBRARY_TAG_PARAMS) next.delete(key);
  if (contentTypes.length > 0) next.set("types", contentTypes.map(String).join(","));
  else next.delete("types");
  next.delete("domain");

  return next;
}

function writeToParams(
  base: URLSearchParams,
  criteria: SerializedTagFilterCriteria,
): URLSearchParams {
  const next = sanitizeLibraryTagFilterParams(base);
  const setOrDelete = (key: string, value: string | null) => {
    if (value && value.length > 0) next.set(key, value);
    else next.delete(key);
  };
  setOrDelete("types", criteria.contentTypes.map(String).join(","));
  return next;
}

export function isCriteriaEmpty(criteria: SerializedTagFilterCriteria): boolean {
  return (
    criteria.tagIds.length === 0 &&
    criteria.contentTypes.length === 0 &&
    criteria.ownerIds.length === 0 &&
    criteria.sources.length === 0 &&
    !criteria.createdAfter &&
    !criteria.createdBefore &&
    !criteria.updatedAfter &&
    !criteria.updatedBefore &&
    criteria.accessMode === null &&
    !criteria.untaggedOnly
  );
}

export function criteriaEquals(
  a: SerializedTagFilterCriteria,
  b: SerializedTagFilterCriteria,
): boolean {
  const arrEq = (x: readonly (string | number)[], y: readonly (string | number)[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    arrEq([...a.tagIds].sort(), [...b.tagIds].sort()) &&
    arrEq([...a.contentTypes].sort(), [...b.contentTypes].sort()) &&
    arrEq([...a.ownerIds].sort(), [...b.ownerIds].sort()) &&
    arrEq([...a.sources].sort(), [...b.sources].sort()) &&
    a.createdAfter === b.createdAfter &&
    a.createdBefore === b.createdBefore &&
    a.updatedAfter === b.updatedAfter &&
    a.updatedBefore === b.updatedBefore &&
    a.accessMode === b.accessMode &&
    a.untaggedOnly === b.untaggedOnly
  );
}

export interface UseTagFilterStateReturn {
  criteria: SerializedTagFilterCriteria;
  setCriteria: (next: SerializedTagFilterCriteria) => void;
  patch: (patch: Partial<SerializedTagFilterCriteria>) => void;
  reset: () => void;
  isEmpty: boolean;
}

export function useTagFilterState(): UseTagFilterStateReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const criteria = useMemo(() => readLibraryTagFilterCriteria(searchParams), [searchParams]);

  const setCriteria = useCallback(
    (next: SerializedTagFilterCriteria) => {
      setSearchParams((current) => writeToParams(current, next), { replace: false });
    },
    [setSearchParams],
  );

  const patch = useCallback(
    (partial: Partial<SerializedTagFilterCriteria>) => {
      setCriteria({ ...criteria, ...partial });
    },
    [criteria, setCriteria],
  );

  const reset = useCallback(() => setCriteria(emptyCriteria()), [setCriteria]);

  return {
    criteria,
    setCriteria,
    patch,
    reset,
    isEmpty: isCriteriaEmpty(criteria),
  };
}
