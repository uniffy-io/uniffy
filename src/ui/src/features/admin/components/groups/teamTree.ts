import type { SerializedGroupInfo } from '@/features/admin/store/adminSlice';

export interface TeamTreeRow {
    team: SerializedGroupInfo;
    depth: number;
}

export function flattenTeamTree(teams: SerializedGroupInfo[]): TeamTreeRow[] {
    const ids = new Set(teams.map((t) => t.id));
    const byParent = new Map<string | null, SerializedGroupInfo[]>();
    for (const team of teams) {
        const parentId =
            team.parentGroupId && team.parentGroupId !== team.id && ids.has(team.parentGroupId)
                ? team.parentGroupId
                : null;
        const siblings = byParent.get(parentId) ?? [];
        siblings.push(team);
        byParent.set(parentId, siblings);
    }

    const rows: TeamTreeRow[] = [];
    const visited = new Set<string>();
    const walk = (parentId: string | null, depth: number) => {
        for (const team of byParent.get(parentId) ?? []) {
            if (visited.has(team.id)) continue;
            visited.add(team.id);
            rows.push({ team, depth });
            walk(team.id, depth + 1);
        }
    };
    walk(null, 0);

    // Teams inside a parent cycle are unreachable from any root; surface them flat.
    for (const team of teams) {
        if (visited.has(team.id)) continue;
        visited.add(team.id);
        rows.push({ team, depth: 0 });
        walk(team.id, 1);
    }
    return rows;
}
