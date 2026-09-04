import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, TreeStructure } from "@phosphor-icons/react";
import { GroupKind } from "@uniffy/proto/common/v1/common_pb";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useGroups } from "@/features/admin/hooks/useAdminHooks";
import type { SerializedGroupInfo } from "@/features/admin/store/adminSlice";
import { GroupDirectoryCard } from "@/features/admin/components/groups/GroupDirectoryCard";
import { GroupMembersModal } from "@/features/admin/components/groups/GroupMembersModal";
import {
  TeamFormModal,
  type TeamFormValues,
} from "@/features/admin/components/groups/TeamFormModal";
import { flattenTeamTree } from "@/features/admin/components/groups/teamTree";

export function TeamsPage() {
  useDocumentTitle("Teams");

  const { groups, loading, refresh, create, update, remove } = useGroups();
  const [editingTeam, setEditingTeam] = useState<SerializedGroupInfo | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingMembersTeam, setViewingMembersTeam] = useState<SerializedGroupInfo | null>(null);

  useEffect(() => {
    refresh({ includePrivate: true });
  }, [refresh]);

  const teams = useMemo(() => groups.filter((group) => group.kind === GroupKind.TEAM), [groups]);
  const namesById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const rows = useMemo(() => flattenTeamTree(teams), [teams]);

  const handleCreate = async (values: TeamFormValues) => {
    await create({
      name: values.name,
      description: values.description,
      kind: GroupKind.TEAM,
      leadUserId: values.leadUserId,
      parentGroupId: values.parentGroupId,
    });
  };

  const handleUpdate = async (values: TeamFormValues) => {
    if (editingTeam) {
      await update(editingTeam.id, values);
    }
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <TreeStructure size={24} weight="duotone" className="text-primary shrink-0" />
            <h1 className="text-xl md:text-2xl font-bold">Teams</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            A team is an org-structure unit with a lead and an optional parent team; teams shape the{" "}
            <Link to="/people" className="text-primary hover:underline">
              org chart
            </Link>{" "}
            and can be invited anywhere people are picked. Reporting lines are set from a
            team&apos;s roster here, or per member in{" "}
            <Link to="/admin/members" className="text-primary hover:underline">
              Members
            </Link>
            .
          </p>
        </div>
        <Button size="md" className="shrink-0" onClick={() => setShowCreateModal(true)}>
          <Plus size={16} />
          <span className="hidden sm:inline">Create Team</span>
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading teams...</p>
        </div>
      ) : teams.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-border rounded-lg">
          <TreeStructure
            size={48}
            weight="duotone"
            className="mx-auto text-subtle-foreground mb-4"
          />
          <h3 className="text-lg font-medium mb-2">No teams yet</h3>
          <p className="text-muted-foreground mb-4">Create one to start building the org chart.</p>
          <Button size="md" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} />
            Create your first team
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(({ team, depth }) => (
            <div key={team.id} style={{ paddingLeft: Math.min(depth, 6) * 20 }}>
              <GroupDirectoryCard
                group={team}
                parentName={team.parentGroupId ? namesById.get(team.parentGroupId) : undefined}
                onEdit={setEditingTeam}
                onDelete={remove}
                onViewMembers={setViewingMembersTeam}
              />
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <TeamFormModal
          allTeams={teams}
          onSave={handleCreate}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {editingTeam && (
        <TeamFormModal
          team={editingTeam}
          allTeams={teams}
          onSave={handleUpdate}
          onClose={() => setEditingTeam(null)}
        />
      )}

      {viewingMembersTeam && (
        <GroupMembersModal group={viewingMembersTeam} onClose={() => setViewingMembersTeam(null)} />
      )}
    </div>
  );
}
