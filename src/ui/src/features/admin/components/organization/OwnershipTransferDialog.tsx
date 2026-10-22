import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { MemberInfo } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatarById } from "@/components/subject";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { OptionTile } from "@/components/ui/option-tile";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyErrorMessage } from "@/config";
import { adminApi } from "@/features/admin/api/adminApi";
import { transferOrganizationOwnership } from "@/features/admin/components/organization/organizationChanges";
import { DIRECTORY_MEMBERS_PAGE_SIZE } from "@/features/admin/store/adminThunks";

const SEARCH_DELAY_MS = 300;

interface MemberResult {
  query: string;
  members: MemberInfo[];
  error: string | null;
}

interface OwnershipTransferDialogProps {
  organizationId: string;
  organizationName: string;
  onClose: () => void;
  onTransferred: () => void;
}

export function OwnershipTransferDialog({
  organizationId,
  organizationName,
  onClose,
  onTransferred,
}: OwnershipTransferDialogProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? null);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<MemberResult | null>(null);
  const [selected, setSelected] = useState<MemberInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const query = search.trim();
    const timer = setTimeout(
      () => {
        adminApi
          .listMembers({
            organizationId,
            pagination: { page: 1, pageSize: DIRECTORY_MEMBERS_PAGE_SIZE },
            search: query || undefined,
          })
          .then((response) => {
            if (cancelled) return;
            const members = response.members.filter(
              (member) => member.isActive && member.userId !== currentUserId,
            );
            setResult({ query: search, members, error: null });
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            const message =
              friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
              "Members could not be loaded.";
            setResult({ query: search, members: [], error: message });
          });
      },
      query ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentUserId, organizationId, search]);

  const loading = result?.query !== search;

  const transfer = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      await transferOrganizationOwnership(dispatch, organizationId, selected.userId);
      toast.success(`${selected.displayName} now owns ${organizationName}.`);
      onTransferred();
    } catch (err) {
      const message = friendlyErrorMessage(err instanceof Error ? err.message : String(err));
      if (message) toast.error(message);
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-lg">
      <ModalHeader
        title="Transfer ownership"
        description={confirming ? undefined : `Pick the member who will own ${organizationName}.`}
      />

      {confirming && selected ? (
        <ModalBody>
          <p className="text-sm text-foreground">
            {selected.displayName} becomes the owner. You stay as an admin.
          </p>
          <p className="text-sm text-muted-foreground">
            Only the owner can transfer ownership or delete the organization.
          </p>
        </ModalBody>
      ) : (
        <ModalBody>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search members"
            aria-label="Search members"
            autoFocus
          />
          {loading && !result ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} variant="rectangular" className="h-14 w-full" />
              ))}
            </div>
          ) : result?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {result.error}
            </p>
          ) : result && result.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {result.query.trim()
                ? "No active member matches that search."
                : "No other active members. Invite someone first, or delete the organization."}
            </p>
          ) : (
            <div
              role="radiogroup"
              aria-label="New owner"
              className={loading ? "space-y-2 opacity-60" : "space-y-2"}
            >
              {result?.members.map((member) => (
                <OptionTile
                  key={member.userId}
                  selected={selected?.userId === member.userId}
                  icon={
                    <SubjectAvatarById
                      userId={member.userId}
                      displayName={member.displayName}
                      avatarUrl={member.avatarUrl || undefined}
                      size="md"
                    />
                  }
                  label={member.displayName}
                  description={member.email}
                  onSelect={() => setSelected(member)}
                />
              ))}
            </div>
          )}
        </ModalBody>
      )}

      <ModalFooter>
        {confirming ? (
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={submitting}>
              Back
            </Button>
            <Button variant="warning" onClick={() => void transfer()} loading={submitting}>
              {submitting ? "Transferring..." : "Transfer ownership"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={!selected}>
              Continue
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
