import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  X,
  GlobeSimple,
  Lock,
  UserPlus,
  Crown,
  ShieldStar,
  Trash,
  Archive,
  UserMinus,
  MagnifyingGlass,
  CalendarBlank,
  Info,
  Gauge,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubjectAvatarById } from "@/components/subject/SubjectAvatar";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { useSubjectSearch } from "@/components/subject/hooks/useSubjectSearch";
import { SUBJECT_TYPE } from "@/components/subject/types";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { AgentContextBar } from "@/features/chat/components/channel/AgentContextBar";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import { adminApi } from "@/features/admin/api/adminApi";
import { cn } from "@/shared/utils/cn";
import {
  selectActiveChannel,
  selectChannelMembers,
  selectCategories,
} from "@/features/chat/store/chatChannelsSlice";
import {
  closeChannelSettingsModal,
  selectChannelSettingsModalTab,
} from "@/features/chat/store/chatUiSlice";
import {
  updateChannelThunk,
  addMembersThunk,
  removeMemberThunk,
  updateMemberRoleThunk,
  fetchMembers,
  deleteChannel,
  archiveChannel,
} from "@/features/chat/store/chatThunks";
import { useChatPermissions } from "@/features/chat/hooks/useChatPermissions";
import { formatDateFull } from "@/shared/utils/dateFormatting";
import type { ChatChannelMember } from "@/features/chat/types";
import { TagPicker } from "@/features/tags";
import { PendingAccessRequests } from "@/features/permissions";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";

type SettingsTab = "overview" | "members";

const ROLE_BADGE_STYLES: Record<string, string> = {
  OWNER: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  ADMIN: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  MEMBER: "bg-muted text-muted-foreground",
};

const ROLE_ICONS: Record<string, typeof Crown | null> = {
  OWNER: Crown,
  ADMIN: ShieldStar,
  MEMBER: null,
};

const MAX_NAME_LENGTH = 50;

export function ChannelSettingsModal() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const activeChannel = useAppSelector(selectActiveChannel);
  const initialTab = useAppSelector(selectChannelSettingsModalTab);
  const categories = useAppSelector(selectCategories);
  const currentUserId = useAppSelector((s) => s.auth.user?.id);
  const currentOrgId = useAppSelector((s) => s.auth.currentOrganizationId);
  const { canManageChat } = useChatPermissions();

  const channelId = activeChannel?.id ?? "";
  const members = useAppSelector((s) => selectChannelMembers(s, channelId));

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const [name, setName] = useState(activeChannel?.name ?? "");
  const [description, setDescription] = useState(activeChannel?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | undefined>(
    activeChannel?.categoryId ?? undefined,
  );
  const [tagIds, setTagIds] = useState<string[]>(activeChannel?.tagIds ?? []);

  const [isSaving, setIsSaving] = useState(false);
  const [addMemberQuery, setAddMemberQuery] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<ChatChannelMember | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  const addInputRef = useRef<HTMLInputElement>(null);

  const memberUserIds = useMemo(() => members.map((m) => m.userId), [members]);
  const { subjects: memberSubjects } = useSubjectResolver(memberUserIds);
  const memberSubjectMap = useMemo(() => {
    const map: Record<string, { name: string; email?: string }> = {};
    for (const s of memberSubjects) {
      map[s.id] = { name: s.name, email: s.email };
    }
    return map;
  }, [memberSubjects]);

  const currentUserMember = useMemo(
    () => members.find((m) => m.userId === currentUserId),
    [members, currentUserId],
  );
  const currentUserRole = currentUserMember?.role;
  const canEdit = canManageChat || currentUserRole === "OWNER" || currentUserRole === "ADMIN";
  const actorIsOwner = canManageChat || currentUserRole === "OWNER";
  const actorIsAdmin = actorIsOwner || currentUserRole === "ADMIN";
  const ownerCount = useMemo(
    () => members.filter((m) => m.subjectType === "USER" && m.role === "OWNER").length,
    [members],
  );
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);

  const handleRoleChange = async (userId: string, role: "MEMBER" | "ADMIN" | "OWNER") => {
    setChangingRoleId(userId);
    try {
      await dispatch(updateMemberRoleThunk({ channelId, userId, role })).unwrap();
    } finally {
      setChangingRoleId(null);
    }
  };

  const isDirty = useMemo(() => {
    if (!activeChannel) return false;
    const sortedNew = [...tagIds].sort().join(",");
    const sortedOld = [...(activeChannel.tagIds ?? [])].sort().join(",");
    return (
      name !== activeChannel.name ||
      description !== (activeChannel.description ?? "") ||
      (categoryId ?? "") !== (activeChannel.categoryId ?? "") ||
      sortedNew !== sortedOld
    );
  }, [name, description, categoryId, tagIds, activeChannel]);

  useEffect(() => {
    if (channelId) {
      dispatch(fetchMembers(channelId));
    }
  }, [dispatch, channelId]);

  const handleClose = useCallback(() => {
    dispatch(closeChannelSettingsModal());
  }, [dispatch]);

  const existingMemberIds = useMemo(() => members.map((m) => m.userId), [members]);

  const sortedMembers = useMemo(() => {
    const roleOrder: Record<string, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
    return [...members].sort((a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3));
  }, [members]);

  const categoryOptions = useMemo(
    () => [
      { value: "", label: "No category" },
      ...categories.map((c) => ({ value: c.id, label: c.name })),
    ],
    [categories],
  );

  const roleSelectOptions = useMemo(() => {
    const base = [
      { value: "MEMBER", label: "Member" },
      { value: "ADMIN", label: "Admin" },
    ];
    return actorIsOwner ? [...base, { value: "OWNER", label: "Owner" }] : base;
  }, [actorIsOwner]);

  const isChannelPublic = activeChannel?.channelType === "PUBLIC";

  const {
    results: searchResults,
    loading: searchLoading,
    search,
  } = useSubjectSearch({
    subjectTypes: "all",
    excludeIds: existingMemberIds,
  });

  useEffect(() => {
    search(addMemberQuery);
  }, [addMemberQuery, search]);

  // Agents aren't in the subject search index; pull from the agents slice and let the backend reject dupes.
  const agentsMap = useAppSelector(selectAllAgents);
  const agentMatches = useMemo(() => {
    const needle = addMemberQuery.trim().toLowerCase();
    if (needle.length < 2) return [];
    return Object.values(agentsMap)
      .filter((a) => a.name.toLowerCase().includes(needle))
      .slice(0, 10);
  }, [agentsMap, addMemberQuery]);

  if (
    !activeChannel ||
    activeChannel.channelType === "DIRECT" ||
    activeChannel.channelType === "GROUP_DM"
  ) {
    return null;
  }

  const handleSave = async () => {
    if (!isDirty || !canEdit) return;
    setIsSaving(true);
    try {
      await dispatch(
        updateChannelThunk({
          channelId,
          name: name.trim(),
          description: description.trim(),
          categoryId: categoryId || undefined,
          originalCategoryId: activeChannel.categoryId ?? undefined,
          tagIds,
        }),
      ).unwrap();
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddSubject = async (subject: { id: string; type: number }) => {
    setIsAddingMembers(true);
    try {
      let userIds: string[];
      if (subject.type === SUBJECT_TYPE.GROUP) {
        const res = await adminApi.listGroupMembers({
          organizationId: currentOrgId ?? "",
          groupId: subject.id,
        });
        userIds = (res.members ?? [])
          .map((m) => m.userId)
          .filter((uid): uid is string => !!uid && !existingMemberIds.includes(uid));
      } else {
        userIds = [subject.id];
      }
      if (userIds.length > 0) {
        await dispatch(addMembersThunk({ channelId, userIds })).unwrap();
      }
      setAddMemberQuery("");
      addInputRef.current?.focus();
    } finally {
      setIsAddingMembers(false);
    }
  };

  const handleAddAgent = async (agentId: string) => {
    setIsAddingMembers(true);
    try {
      await dispatch(
        addMembersThunk({
          channelId,
          subjects: [{ type: "AGENT", id: agentId }],
        }),
      ).unwrap();
      setAddMemberQuery("");
      addInputRef.current?.focus();
    } finally {
      setIsAddingMembers(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!memberToRemove) return;
    const subjectKey = memberToRemove.subjectId || memberToRemove.userId;
    setRemovingMemberId(subjectKey);
    try {
      await dispatch(
        removeMemberThunk({
          channelId,
          subject: {
            type: memberToRemove.subjectType === "AGENT" ? "AGENT" : "USER",
            id: subjectKey,
          },
        }),
      ).unwrap();
      setShowRemoveConfirm(false);
      setMemberToRemove(null);
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await dispatch(deleteChannel(channelId)).unwrap();
      handleClose();
      navigate("/chat");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchive = async () => {
    setIsArchiving(true);
    try {
      await dispatch(archiveChannel(channelId)).unwrap();
      handleClose();
      navigate("/chat");
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <>
      <Modal onClose={handleClose} closeDisabled={isSaving || isDeleting} maxWidth="max-w-lg">
        <div
          className="flex flex-col"
          style={{ maxHeight: "75vh" }}
          data-testid="chat-channel-settings-modal"
          data-tab={activeTab}
        >
          <div className="flex items-center justify-between px-6 pt-6 pb-2 shrink-0">
            <h2 className="text-xl font-semibold text-foreground">Channel settings</h2>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSaving || isDeleting}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              data-testid="chat-channel-settings-close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="mx-6 mt-2 mb-4 shrink-0">
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3.5",
                isChannelPublic ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30",
              )}
            >
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  isChannelPublic ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {isChannelPublic ? (
                  <GlobeSimple size={22} weight="bold" />
                ) : (
                  <Lock size={22} weight="bold" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{activeChannel.name}</p>
                <p className="text-xs text-muted-foreground">
                  {isChannelPublic ? "Public channel" : "Private channel"} &middot; {members.length}{" "}
                  {members.length === 1 ? "member" : "members"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-1 px-6 shrink-0">
            {(["overview", "members"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  activeTab === tab
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
                data-testid={`chat-channel-settings-tab-${tab}`}
                data-active={activeTab === tab ? "true" : "false"}
              >
                {tab === "overview" ? "Overview" : `Members (${members.length})`}
              </button>
            ))}
          </div>

          <div className="border-b border-border mt-2 shrink-0" />

          <div className="flex-1 overflow-y-auto min-h-0">
            {activeTab === "overview" ? (
              <div className="px-6 py-5 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Channel name
                  </label>
                  <Input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
                    disabled={!canEdit || isSaving}
                    placeholder="Enter a name for your channel"
                  />
                  <div className="flex items-center justify-between mt-1">
                    <span />
                    {canEdit && (
                      <p
                        className={cn(
                          "text-xs tabular-nums",
                          name.length >= MAX_NAME_LENGTH ? "text-red-500" : "text-muted-foreground",
                        )}
                      >
                        {name.length}/{MAX_NAME_LENGTH}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Channel Purpose
                    <span className="text-muted-foreground font-normal ml-1">(optional)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={!canEdit || isSaving}
                    rows={3}
                    placeholder="What is this channel about?"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none disabled:opacity-50"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    This will be displayed when browsing for channels.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Tags
                    <span className="text-muted-foreground font-normal ml-1">(optional)</span>
                  </label>
                  <TagPicker
                    selectedTagIds={tagIds}
                    onChange={setTagIds}
                    disabled={!canEdit || isSaving}
                    placeholder="Add a tag"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Group related channels with shared tags. Visible from the unified Tags
                    dashboard.
                  </p>
                </div>

                {categories.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Category
                      <span className="text-muted-foreground font-normal ml-1">(optional)</span>
                    </label>
                    <Select
                      value={categoryId ?? ""}
                      onChange={(v) => setCategoryId(v || undefined)}
                      options={categoryOptions}
                      size="md"
                      disabled={!canEdit || isSaving}
                    />
                  </div>
                )}

                {activeChannel.createdAt && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                    <CalendarBlank size={14} />
                    <span>Created {formatDateFull(activeChannel.createdAt)}</span>
                  </div>
                )}

                {canEdit && (
                  <div className="mt-2 pt-4 border-t border-border">
                    <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-4">
                      <p className="text-sm font-medium text-foreground mb-3">Danger zone</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowArchiveConfirm(true)}
                          disabled={isArchiving || isDeleting}
                        >
                          <Archive size={14} className="mr-1.5" />
                          Archive
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setShowDeleteConfirm(true)}
                          disabled={isArchiving || isDeleting}
                        >
                          <Trash size={14} className="mr-1.5" />
                          Delete channel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col">
                {canEdit && activeChannel.channelType === "PRIVATE" && (
                  <div className="border-b border-border px-6 py-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Pending access requests
                    </h3>
                    <PendingAccessRequests
                      canonicalContentType={ContentType.CHAT}
                      canonicalContentId={channelId}
                    />
                  </div>
                )}
                {canEdit && (
                  <div className="px-6 pt-4 pb-3">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                      <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
                      <input
                        ref={addInputRef}
                        type="text"
                        value={addMemberQuery}
                        onChange={(e) => {
                          setAddMemberQuery(e.target.value);
                          if (!showAddMember) setShowAddMember(true);
                        }}
                        onFocus={() => setShowAddMember(true)}
                        placeholder="Search people, groups, or agents to add..."
                        disabled={isAddingMembers}
                        className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                      />
                    </div>

                    {showAddMember && addMemberQuery.length >= 2 && (
                      <div className="mt-1 rounded-lg border border-border bg-card shadow-lg max-h-[260px] overflow-y-auto">
                        {searchLoading &&
                        searchResults.length === 0 &&
                        agentMatches.length === 0 ? (
                          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                            Searching...
                          </div>
                        ) : searchResults.length === 0 && agentMatches.length === 0 ? (
                          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                            No results found
                          </div>
                        ) : (
                          <>
                            {searchResults.length > 0 && (
                              <div className="py-1">
                                {searchResults.map((subject) => (
                                  <button
                                    key={subject.id}
                                    type="button"
                                    onClick={() => handleAddSubject(subject)}
                                    disabled={isAddingMembers}
                                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-50"
                                  >
                                    <SubjectAvatar subject={subject} size="sm" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-foreground truncate">
                                        {subject.name}
                                      </p>
                                      {subject.type === SUBJECT_TYPE.GROUP ? (
                                        <p className="text-xs text-muted-foreground truncate">
                                          Group
                                          {subject.memberCount
                                            ? ` (${subject.memberCount} members)`
                                            : ""}
                                        </p>
                                      ) : subject.email ? (
                                        <p className="text-xs text-muted-foreground truncate">
                                          {subject.email}
                                        </p>
                                      ) : null}
                                    </div>
                                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
                                      <UserPlus size={12} weight="bold" />
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}

                            {agentMatches.length > 0 && (
                              <div className="py-1 border-t border-border">
                                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
                                  Agents
                                </div>
                                {agentMatches.map((agent) => (
                                  <button
                                    key={agent.id}
                                    type="button"
                                    onClick={() => handleAddAgent(agent.id)}
                                    disabled={isAddingMembers}
                                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-50"
                                  >
                                    <AgentAvatar
                                      avatarKey={agent.avatarKey}
                                      avatarEmoji={agent.avatarEmoji}
                                      agentName={agent.name}
                                      size="sm"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-foreground truncate">
                                        {agent.name}
                                      </p>
                                      <p className="text-xs text-muted-foreground truncate">
                                        Agent
                                      </p>
                                    </div>
                                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
                                      <UserPlus size={12} weight="bold" />
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="px-3 pb-4">
                  {sortedMembers.length === 0 ? (
                    <div className="flex flex-col items-center py-8 text-muted-foreground">
                      <Info size={32} className="mb-2 opacity-50" />
                      <p className="text-sm">No members found</p>
                    </div>
                  ) : (
                    sortedMembers.map((member) => {
                      const isAgentMember = member.subjectType === "AGENT";
                      const agent = isAgentMember ? agentsMap[member.subjectId] : null;
                      const subject = memberSubjectMap[member.userId];
                      const displayName = isAgentMember
                        ? (agent?.name ?? member.displayName ?? member.subjectId.slice(-6))
                        : (subject?.name ?? member.displayName ?? member.userId.slice(-6));
                      const memberKey = isAgentMember ? member.subjectId : member.userId;
                      const RoleIcon = ROLE_ICONS[member.role];
                      const isOwner = member.role === "OWNER";
                      const isSelf = !isAgentMember && member.userId === currentUserId;
                      const isRemoving = removingMemberId === memberKey;
                      const isAgentExpanded = isAgentMember && expandedAgentId === member.subjectId;
                      // The last owner keeps a static badge; demoting them
                      // would orphan the channel and the backend rejects it.
                      const canChangeRole =
                        !isAgentMember &&
                        actorIsAdmin &&
                        (!isOwner || (actorIsOwner && ownerCount > 1));

                      return (
                        <div
                          key={memberKey}
                          className={cn(
                            "rounded-lg transition-colors",
                            isAgentExpanded ? "bg-muted/40" : "hover:bg-muted/50",
                          )}
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
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    (you)
                                  </span>
                                )}
                                {isAgentMember && (
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                                    Agent
                                  </span>
                                )}
                              </div>
                              {!isAgentMember && subject?.email && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {subject.email}
                                </p>
                              )}
                            </div>
                            {canChangeRole ? (
                              <div
                                className="shrink-0 w-[104px]"
                                data-testid={`chat-member-role-select-${member.userId}`}
                              >
                                <Select
                                  value={member.role}
                                  onChange={(v) =>
                                    handleRoleChange(
                                      member.userId,
                                      v as "MEMBER" | "ADMIN" | "OWNER",
                                    )
                                  }
                                  options={roleSelectOptions}
                                  size="sm"
                                  disabled={changingRoleId === member.userId}
                                />
                              </div>
                            ) : (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0",
                                  ROLE_BADGE_STYLES[member.role],
                                )}
                              >
                                {RoleIcon && <RoleIcon size={11} weight="fill" />}
                                {member.role}
                              </span>
                            )}
                            {isAgentMember && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedAgentId((prev) =>
                                    prev === member.subjectId ? null : member.subjectId,
                                  )
                                }
                                className={cn(
                                  "p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
                                  isAgentExpanded && "text-primary bg-primary/10",
                                )}
                                aria-label={
                                  isAgentExpanded ? "Hide agent context" : "Show agent context"
                                }
                                title="Agent context"
                              >
                                <Gauge size={14} />
                              </button>
                            )}
                            {canEdit && !isOwner && !isSelf && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMemberToRemove(member);
                                  setShowRemoveConfirm(true);
                                }}
                                disabled={isRemoving}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors md:opacity-0 md:group-hover:opacity-100 disabled:opacity-50"
                                aria-label={`Remove ${displayName}`}
                              >
                                <UserMinus size={14} />
                              </button>
                            )}
                          </div>
                          {isAgentExpanded && (
                            <div className="border-t border-border/50 mx-3">
                              <AgentContextBar
                                channelId={channelId}
                                agentId={member.subjectId}
                                agentName={displayName}
                                variant="compact"
                                canMutate={canEdit}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {activeTab === "overview" && canEdit && isDirty && (
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setName(activeChannel.name);
                  setDescription(activeChannel.description ?? "");
                  setCategoryId(activeChannel.categoryId ?? undefined);
                }}
                disabled={isSaving}
                data-testid="chat-channel-settings-discard"
              >
                Discard
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || isSaving}
                loading={isSaving}
                data-testid="chat-channel-settings-save"
              >
                Save changes
              </Button>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete channel"
        message={`Are you sure you want to permanently delete #${activeChannel.name}? All messages and data will be lost. This action cannot be undone.`}
        confirmLabel="Delete channel"
        variant="danger"
        loading={isDeleting}
      />

      <ConfirmDialog
        isOpen={showArchiveConfirm}
        onClose={() => setShowArchiveConfirm(false)}
        onConfirm={handleArchive}
        title="Archive channel"
        message={`Are you sure you want to archive #${activeChannel.name}? Members will no longer be able to send messages. The channel can be restored later.`}
        confirmLabel="Archive channel"
        variant="warning"
        loading={isArchiving}
      />

      <ConfirmDialog
        isOpen={showRemoveConfirm}
        onClose={() => {
          setShowRemoveConfirm(false);
          setMemberToRemove(null);
        }}
        onConfirm={handleRemoveMember}
        title="Remove member"
        message={
          memberToRemove
            ? `Remove ${memberSubjectMap[memberToRemove.userId]?.name ?? "this user"} from #${activeChannel.name}?`
            : ""
        }
        confirmLabel="Remove"
        variant="danger"
        loading={removingMemberId !== null}
      />
    </>
  );
}
