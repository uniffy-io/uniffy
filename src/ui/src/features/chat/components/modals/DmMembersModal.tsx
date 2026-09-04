import { useEffect, useMemo, useState, useRef } from "react";
import {
  Users,
  UserPlus,
  UserMinus,
  MagnifyingGlass,
  Crown,
  ChatsCircle,
  ArrowsLeftRight,
  GlobeSimple,
  Lock,
  Check,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Modal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubjectAvatar, SubjectAvatarById } from "@/components/subject/SubjectAvatar";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { useSubjectSearch } from "@/components/subject/hooks/useSubjectSearch";
import { SUBJECT_TYPE } from "@/components/subject/types";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import { cn } from "@/shared/utils/cn";
import { popoverShellClass } from "@/components/ui/popover";
import { selectActiveChannel, selectChannelMembers } from "@/features/chat/store/chatChannelsSlice";
import { closeChannelSettingsModal } from "@/features/chat/store/chatUiSlice";
import {
  fetchMembers,
  addMembersThunk,
  removeMemberThunk,
  updateMemberRoleThunk,
  convertGroupDmToChannel,
} from "@/features/chat/store/chatThunks";
import { getChannelDisplayName } from "@/features/chat/utils/channelDisplay";
import { ChannelType } from "@uniffy/proto/chat/v1/chat_pb";
import type { ChatChannelMember } from "@/features/chat/types";

const GROUP_DM_MEMBER_CAP = 4;
const MAX_NAME_LENGTH = 50;

/** DM-type counterpart of ChannelSettingsModal: members, group-DM add/remove, convert to channel. */
export function DmMembersModal() {
  const dispatch = useAppDispatch();
  const channel = useAppSelector(selectActiveChannel);
  const currentUserId = useAppSelector((s) => s.auth.user?.id);
  const channelId = channel?.id ?? "";
  const members = useAppSelector((s) => selectChannelMembers(s, channelId));
  const agentsMap = useAppSelector(selectAllAgents);

  const [addMemberQuery, setAddMemberQuery] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<ChatChannelMember | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);
  const [showConvert, setShowConvert] = useState(false);
  const [convertName, setConvertName] = useState("");
  const [convertType, setConvertType] = useState<"public" | "private">("private");
  const [isConverting, setIsConverting] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  const isGroupDm = channel?.channelType === "GROUP_DM";

  useEffect(() => {
    if (channelId) {
      dispatch(fetchMembers(channelId));
    }
  }, [dispatch, channelId]);

  const userIds = useMemo(
    () => members.filter((m) => m.subjectType === "USER").map((m) => m.userId),
    [members],
  );
  const { subjects: memberSubjects } = useSubjectResolver(userIds);
  const memberSubjectMap = useMemo(() => {
    const map: Record<string, { name: string; email?: string }> = {};
    for (const s of memberSubjects) map[s.id] = { name: s.name, email: s.email };
    return map;
  }, [memberSubjects]);

  const currentUserRole = useMemo(
    () => members.find((m) => m.userId === currentUserId)?.role,
    [members, currentUserId],
  );
  const isOwner = currentUserRole === "OWNER";
  const ownerCount = useMemo(
    () => members.filter((m) => m.subjectType === "USER" && m.role === "OWNER").length,
    [members],
  );
  const atCap = isGroupDm && userIds.length >= GROUP_DM_MEMBER_CAP;
  const canAdd = isGroupDm && !atCap;

  const {
    results: searchResults,
    loading: searchLoading,
    search,
  } = useSubjectSearch({
    subjectTypes: "users",
    excludeIds: userIds,
  });

  useEffect(() => {
    search(addMemberQuery);
  }, [addMemberQuery, search]);

  const displayTitle = channel ? getChannelDisplayName(channel) : "";

  if (!channel) return null;

  const handleClose = () => dispatch(closeChannelSettingsModal());

  const handleAdd = async (subjectId: string) => {
    setIsAddingMembers(true);
    try {
      await dispatch(
        addMembersThunk({
          channelId,
          subjects: [{ type: "USER", id: subjectId }],
        }),
      ).unwrap();
      setAddMemberQuery("");
      dispatch(fetchMembers(channelId));
      addInputRef.current?.focus();
    } finally {
      setIsAddingMembers(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!memberToRemove) return;
    setIsRemoving(true);
    try {
      await dispatch(
        removeMemberThunk({
          channelId,
          userId: memberToRemove.userId,
        }),
      ).unwrap();
      setMemberToRemove(null);
      dispatch(fetchMembers(channelId));
    } finally {
      setIsRemoving(false);
    }
  };

  const handleRoleChange = async (userId: string, role: "MEMBER" | "OWNER") => {
    setChangingRoleId(userId);
    try {
      await dispatch(updateMemberRoleThunk({ channelId, userId, role })).unwrap();
    } finally {
      setChangingRoleId(null);
    }
  };

  const handleConvert = async () => {
    const name = convertName.trim();
    if (!name) return;
    setIsConverting(true);
    try {
      await dispatch(
        convertGroupDmToChannel({
          channelId,
          name,
          channelType: convertType === "public" ? ChannelType.PUBLIC : ChannelType.PRIVATE,
        }),
      ).unwrap();
      handleClose();
    } finally {
      setIsConverting(false);
    }
  };

  const removeTargetName = memberToRemove
    ? (memberSubjectMap[memberToRemove.userId]?.name ?? memberToRemove.displayName ?? "this member")
    : "";

  const sortedMembers = [...members].sort((a, b) => {
    const order: Record<string, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
    return (order[a.role] ?? 3) - (order[b.role] ?? 3);
  });

  return (
    <>
      <Modal
        onClose={handleClose}
        closeDisabled={isConverting}
        maxWidth="max-w-lg"
        className="flex flex-col max-h-[85dvh]"
      >
        <div className="flex flex-col min-h-0" data-testid="chat-dm-members-modal">
          <ModalHeader
            title={isGroupDm ? "Group chat" : "Direct message"}
            onClose={handleClose}
            closeDisabled={isConverting}
            closeTestId="chat-dm-members-close"
          />

          <div className="px-6 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {isGroupDm ? (
                  <Users size={22} weight="bold" />
                ) : (
                  <ChatsCircle size={22} weight="bold" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{displayTitle}</p>
                <p className="text-xs text-muted-foreground">
                  {isGroupDm ? "Group chat" : "Direct message"} &middot; {members.length}{" "}
                  {members.length === 1 ? "member" : "members"}
                  {isGroupDm && ` of ${GROUP_DM_MEMBER_CAP}`}
                </p>
              </div>
            </div>
          </div>

          <ModalBody scrollable={false} className="flex-1 min-h-0 overflow-y-auto p-0 space-y-0">
            {canAdd && (
              <div className="px-6 pt-4">
                <div className="relative">
                  <MagnifyingGlass
                    size={14}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    ref={addInputRef}
                    type="text"
                    value={addMemberQuery}
                    onChange={(e) => {
                      setAddMemberQuery(e.target.value);
                      if (!showAddMember) setShowAddMember(true);
                    }}
                    onFocus={() => setShowAddMember(true)}
                    placeholder="Search people to add..."
                    disabled={isAddingMembers}
                    className="pl-8"
                    data-testid="chat-dm-members-add-search"
                  />
                </div>

                {showAddMember && addMemberQuery.length >= 2 && (
                  <div className={cn(popoverShellClass, "mt-1 max-h-[220px] overflow-y-auto")}>
                    {searchLoading && searchResults.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        Searching...
                      </div>
                    ) : searchResults.filter((r) => r.type === SUBJECT_TYPE.USER).length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No results found
                      </div>
                    ) : (
                      <div className="py-1">
                        {searchResults
                          .filter((r) => r.type === SUBJECT_TYPE.USER)
                          .map((subject) => (
                            <button
                              key={subject.id}
                              type="button"
                              onClick={() => handleAdd(subject.id)}
                              disabled={isAddingMembers}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-50"
                              data-testid={`chat-dm-members-add-${subject.id}`}
                            >
                              <SubjectAvatar subject={subject} size="sm" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {subject.name}
                                </p>
                                {subject.email && (
                                  <p className="text-xs text-muted-foreground truncate">
                                    {subject.email}
                                  </p>
                                )}
                              </div>
                              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
                                <UserPlus size={12} weight="bold" />
                              </div>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {atCap && (
              <div
                className="mx-6 mt-4 rounded-lg border border-yellow-300 bg-yellow-100 p-3.5 text-sm text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-900/30 dark:text-yellow-400"
                data-testid="chat-dm-members-cap-notice"
              >
                Group chats are limited to {GROUP_DM_MEMBER_CAP} people.
                {isOwner
                  ? " Convert this conversation to a channel to keep adding people."
                  : " The conversation owner can convert it to a channel to keep adding people."}
              </div>
            )}

            <div className="px-3 py-4">
              {sortedMembers.map((member) => {
                const isAgentMember = member.subjectType === "AGENT";
                const agent = isAgentMember ? agentsMap[member.subjectId] : null;
                const subject = memberSubjectMap[member.userId];
                const displayName = isAgentMember
                  ? (agent?.name ?? member.displayName ?? "Agent")
                  : (subject?.name ?? member.displayName ?? member.userId.slice(-6));
                const isSelf = !isAgentMember && member.userId === currentUserId;
                const canRemove =
                  isGroupDm && isOwner && !isAgentMember && member.role !== "OWNER" && !isSelf;
                const canPromote =
                  isGroupDm && isOwner && !isAgentMember && !isSelf && member.role !== "OWNER";
                const canDemote =
                  isGroupDm &&
                  isOwner &&
                  !isAgentMember &&
                  !isSelf &&
                  member.role === "OWNER" &&
                  ownerCount > 1;
                const isChangingRole = changingRoleId === member.userId;

                return (
                  <div
                    key={`${member.subjectType}:${member.subjectId}`}
                    className="rounded-lg transition-colors hover:bg-muted/50"
                    data-testid={`chat-dm-member-${member.subjectId}`}
                  >
                    <div className="flex items-center gap-3 px-3 py-2 group">
                      {isAgentMember ? (
                        <AgentAvatar
                          avatarKey={agent?.avatarKey}
                          avatarEmoji={agent?.avatarEmoji}
                          agentName={displayName}
                          size="md"
                        />
                      ) : (
                        <SubjectAvatarById
                          userId={member.userId}
                          displayName={displayName}
                          size="md"
                          showPresence
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground truncate">
                            {displayName}
                          </span>
                          {isSelf && (
                            <span className="text-xs text-muted-foreground shrink-0">(you)</span>
                          )}
                          {isAgentMember && (
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                              Agent
                            </span>
                          )}
                        </div>
                        {!isAgentMember && subject?.email && (
                          <p className="text-xs text-muted-foreground truncate">{subject.email}</p>
                        )}
                      </div>
                      {member.role === "OWNER" && (
                        <span
                          className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 shrink-0"
                          title="Owner"
                        >
                          <Crown size={12} weight="duotone" />
                          Owner
                        </span>
                      )}
                      {canPromote && (
                        <button
                          type="button"
                          onClick={() => handleRoleChange(member.userId, "OWNER")}
                          disabled={isChangingRole}
                          title="Make owner"
                          aria-label={`Make ${displayName} an owner`}
                          className="p-1.5 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-amber-500 hover:bg-amber-500/10 transition-all shrink-0 disabled:opacity-50"
                          data-testid={`chat-dm-member-promote-${member.subjectId}`}
                        >
                          <Crown size={16} />
                        </button>
                      )}
                      {canDemote && (
                        <button
                          type="button"
                          onClick={() => handleRoleChange(member.userId, "MEMBER")}
                          disabled={isChangingRole}
                          title="Remove owner status"
                          aria-label={`Remove owner status from ${displayName}`}
                          className="p-1.5 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-500 hover:bg-red-500/10 transition-all shrink-0 disabled:opacity-50"
                          data-testid={`chat-dm-member-demote-${member.subjectId}`}
                        >
                          <Crown size={16} weight="fill" />
                        </button>
                      )}
                      {canRemove && (
                        <button
                          type="button"
                          onClick={() => setMemberToRemove(member)}
                          aria-label={`Remove ${displayName}`}
                          className="p-1.5 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-500 hover:bg-red-500/10 transition-all shrink-0"
                          data-testid={`chat-dm-member-remove-${member.subjectId}`}
                        >
                          <UserMinus size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {isGroupDm && isOwner && (
              <div className="mx-6 mb-5 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowsLeftRight size={16} className="text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Convert to channel</p>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Members and message history carry over. Channels have no member limit and support
                  tags and categories.
                </p>
                {showConvert ? (
                  <div className="space-y-3">
                    <Input
                      type="text"
                      value={convertName}
                      onChange={(e) => setConvertName(e.target.value.slice(0, MAX_NAME_LENGTH))}
                      placeholder="Channel name"
                      disabled={isConverting}
                      data-testid="chat-dm-convert-name-input"
                    />

                    <div className="grid grid-cols-2 gap-3">
                      {(
                        [
                          {
                            id: "public",
                            label: "Public Channel",
                            hint: "Anyone can join",
                            icon: GlobeSimple,
                          },
                          {
                            id: "private",
                            label: "Private Channel",
                            hint: "Only invited members",
                            icon: Lock,
                          },
                        ] as const
                      ).map(({ id, label, hint, icon: TypeIcon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setConvertType(id)}
                          disabled={isConverting}
                          className={cn(
                            "relative flex items-center gap-3 rounded-lg border p-3.5 text-left transition-colors",
                            convertType === id
                              ? "border-primary bg-primary/5"
                              : "border-border bg-muted/30 hover:border-border-strong",
                          )}
                          data-testid={`chat-dm-convert-type-${id}`}
                          data-selected={convertType === id ? "true" : "false"}
                        >
                          <div
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                              convertType === id
                                ? "bg-primary/15 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            <TypeIcon size={22} weight="bold" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{label}</p>
                            <p className="text-xs text-muted-foreground">{hint}</p>
                          </div>
                          {convertType === id && (
                            <div className="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check size={12} weight="bold" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowConvert(false)}
                        disabled={isConverting}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleConvert}
                        disabled={isConverting || !convertName.trim()}
                        data-testid="chat-dm-convert-confirm"
                      >
                        {isConverting ? "Converting..." : "Convert"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConvertName(displayTitle.slice(0, MAX_NAME_LENGTH));
                      setShowConvert(true);
                    }}
                    data-testid="chat-dm-convert-button"
                  >
                    Convert to channel
                  </Button>
                )}
              </div>
            )}
          </ModalBody>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!memberToRemove}
        onClose={() => setMemberToRemove(null)}
        onConfirm={handleConfirmRemove}
        title="Remove from conversation"
        message={`Remove ${removeTargetName} from this conversation? They will lose access to the message history.`}
        confirmLabel="Remove"
        variant="danger"
        loading={isRemoving}
      />
    </>
  );
}
