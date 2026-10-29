import { CallActivity } from "@/features/calls/components/CallActivity";
import { useCallback, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CaretRight, Phone, Users } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadMoreButton } from "@/components/ui/collection";
import { SkeletonListItem } from "@/components/ui/skeleton";
import { SubjectAvatarById } from "@/components/subject";
import { fetchCallHistory, historyScopeKey } from "@/features/calls/store/callHistorySlice";
import { callDuration } from "@/features/calls/api/historyConverters";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { formatSmartDateTime, formatTimeInZone } from "@/shared/utils/dateFormatting";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";

export function CallHistoryPage() {
  const dispatch = useAppDispatch();
  const { callId } = useParams<{ callId: string }>();
  const [params] = useSearchParams();
  const channelId = params.get("channelId") || undefined;
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const liveCalls = useAppSelector((state) =>
    Object.values(state.calls.activeByChannel)
      .map((call) => call.id)
      .sort()
      .join(","),
  );
  const history = useAppSelector((state) => state.callHistory);
  const scope = historyScopeKey({ organizationId: organizationId ?? "", channelId, callId });
  const current = history.scope === scope;
  const records = current ? history.records : [];
  const record = callId ? records[0] : undefined;
  useDocumentTitle(record?.title ?? "Call history");
  const load = useCallback(
    (cursor?: string) => {
      if (organizationId)
        void dispatch(fetchCallHistory({ organizationId, channelId, callId, cursor }));
    },
    [dispatch, organizationId, channelId, callId],
  );
  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load, liveCalls]);
  const backTo = record
    ? `/calls?channelId=${record.channelId}`
    : channelId
      ? `/chat/${channelId}`
      : "/chat";
  return (
    <div className="flex h-dvh flex-col bg-background">
      <AppHeader />
      <main className="min-h-0 flex-1 overflow-y-auto bg-surface">
        <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
          <Link
            to={backTo}
            className="focus-ring mb-6 inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} />
            {record ? "Channel call history" : "Back to chat"}
          </Link>
          <h1 className="sr-only">{callId ? (record?.title ?? "Call summary") : "Call history"}</h1>
          {current && history.error ? (
            <Card role="alert" className="mb-6 p-5">
              <p className="mb-3 text-sm text-muted-foreground">
                Call history is unavailable. Check your connection and channel access.
              </p>
              <Button variant="outline" onClick={() => load()}>
                Try again
              </Button>
            </Card>
          ) : null}
          {(!current || history.loading) && records.length === 0 ? (
            <div role="status" aria-label="Loading call history" className="space-y-5 py-2">
              {[0, 1, 2].map((index) => (
                <SkeletonListItem key={index} />
              ))}
            </div>
          ) : null}
          {current && !history.loading && !history.error && !records.length ? (
            <EmptyState
              icon={Phone}
              title="No calls yet"
              description="Calls will appear here after you start, join or receive one."
            />
          ) : null}
          {record ? (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <span>{formatSmartDateTime(record.startedAt)}</span>
                <span>{callDuration(record)}</span>
                <span className="inline-flex items-center gap-1.5">
                  <Users size={16} />
                  {record.participantCount}{" "}
                  {record.participantCount === 1 ? "participant" : "participants"}
                </span>
                {record.attended && <span>You joined</span>}
                {record.outcome && <span>{record.outcome} invite</span>}
              </div>
              <CallActivity people={history.people} />
              <details>
                <summary className="focus-ring min-h-11 cursor-pointer rounded-md py-3 text-sm font-medium">
                  Attendance details
                </summary>
                <h2 className="sr-only">People</h2>
                <div className="divide-y divide-border/60">
                  {history.people.map((person) => (
                    <div key={person.userId} className="flex items-center gap-3 py-3">
                      <SubjectAvatarById
                        displayName={person.name}
                        userId={person.userId}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{person.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {person.joinedAt
                            ? `Joined at ${formatTimeInZone(new Date(person.joinedAt), getEffectiveTimeZone())}`
                            : person.outcome || "Invited"}
                        </p>
                      </div>
                      {person.joinedAt && person.outcome && person.outcome !== "Answered" ? (
                        <span className="text-xs text-muted-foreground">
                          {person.outcome} invite
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <div className="divide-y divide-border/60">
              {records.map((item) => (
                <Link
                  key={item.id}
                  to={`/calls/${item.id}`}
                  className="focus-ring group flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-foreground/5"
                >
                  <Phone size={18} className="shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatSmartDateTime(item.startedAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs">
                      {item.outcome === "Missed" || item.outcome === "Declined"
                        ? item.outcome
                        : callDuration(item)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.participantCount} joined
                    </p>
                  </div>
                  <CaretRight size={14} className="shrink-0 text-subtle-foreground" />
                </Link>
              ))}
            </div>
          )}
          {current && history.cursor && (
            <div className="mt-5 flex justify-center">
              <LoadMoreButton loading={history.loading} onClick={() => load(history.cursor)} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
