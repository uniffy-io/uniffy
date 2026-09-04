import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CaretRight, UserCircle } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { AppHeader } from "@/components/layout/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createChannel } from "@/features/chat/store/chatThunks";
import { ChannelType } from "@uniffy/proto/chat/v1/chat_pb";
import { ProfileHeader } from "@/features/people/components/profile/ProfileHeader";
import { ProfileFields } from "@/features/people/components/profile/ProfileFields";
import { ReportingLine } from "@/features/people/components/profile/ReportingLine";
import {
  fetchOrgChartThunk,
  fetchPersonThunk,
  fetchProfilePolicyThunk,
} from "@/features/people/store/peopleThunks";

export function PersonProfilePage() {
  const { userId = "" } = useParams<{ userId: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isZenMode = useAppSelector((s) => s.zenMode.isActive);
  const person = useAppSelector((s) => s.people.profilesById[userId]);
  const status = useAppSelector((s) => s.people.profileStatusById[userId] ?? "idle");
  const policyStatus = useAppSelector((s) => s.people.policy.status);
  const chartStatus = useAppSelector((s) => s.people.chart.status);

  const [messagePending, setMessagePending] = useState(false);

  useDocumentTitle(person?.displayName ?? "People");

  useEffect(() => {
    if (userId) dispatch(fetchPersonThunk({ userId }));
  }, [dispatch, userId]);

  useEffect(() => {
    if (policyStatus === "idle") dispatch(fetchProfilePolicyThunk());
    if (chartStatus === "idle") dispatch(fetchOrgChartThunk());
  }, [dispatch, policyStatus, chartStatus]);

  const handleMessage = async () => {
    if (!person || messagePending) return;
    setMessagePending(true);
    try {
      const channel = await dispatch(
        createChannel({
          name: "",
          channelType: ChannelType.DIRECT,
          memberIds: [person.userId],
        }),
      ).unwrap();
      navigate(`/chat/${channel.id}`);
    } catch {
      setMessagePending(false);
    }
  };

  const isLoading = !person && (status === "idle" || status === "loading");
  const notFound = !person && status === "failed";

  return (
    <>
      <AppHeader />
      <div
        className={cn(
          "bg-background overflow-hidden transition-[height] duration-300 ease-in-out",
          isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0",
        )}
      >
        <div className="h-full overflow-y-auto">
          <div className="container mx-auto max-w-5xl space-y-4 px-3 py-4 md:px-4 md:py-6">
            <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
              <Link
                to="/people"
                className="font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                People
              </Link>
              <CaretRight size={12} className="text-subtle-foreground" />
              <span className="truncate font-medium text-foreground">
                {person?.displayName ?? "Profile"}
              </span>
            </nav>

            {isLoading && (
              <Card tone="surface" className="p-4 md:p-6">
                <div className="flex items-start gap-4">
                  <Skeleton variant="rectangular" className="h-16 w-16" />
                  <div className="flex-1 space-y-2 pt-1">
                    <Skeleton variant="text" className="h-5 w-1/3" />
                    <Skeleton variant="text" className="h-3 w-1/4" />
                    <Skeleton variant="text" className="h-3 w-1/5" />
                  </div>
                </div>
              </Card>
            )}

            {notFound && (
              <Card
                tone="surface"
                className="flex flex-col items-center justify-center gap-3 py-16 text-center"
              >
                <div className="rounded-full bg-muted p-3">
                  <UserCircle size={24} weight="duotone" className="text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  This person could not be found
                </p>
                <p className="text-xs text-muted-foreground">
                  They may have left the organization.
                </p>
                <Button variant="outline" size="sm" onClick={() => navigate("/people")}>
                  Back to people
                </Button>
              </Card>
            )}

            {person && (
              <>
                <ProfileHeader
                  person={person}
                  onMessage={() => void handleMessage()}
                  messagePending={messagePending}
                />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                  <div className="lg:col-span-3">
                    <ProfileFields person={person} />
                  </div>
                  <div className="lg:col-span-2">
                    <ReportingLine person={person} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
