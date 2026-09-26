import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { resetSessionScope, sessionGeneration } from "@core/auth/sessionScope";
import { projectQueryKey, storeProjectView } from "@features/projects/projectViewsCache";
import type { SerializedProject, SerializedView } from "@features/projects/projectsSerializer";

describe("personal view cache", () => {
  it.each(["alice", "bob"])("ignores late saves after signing in as %s", async (nextUser) => {
    const client = new QueryClient();
    const scope = { userId: "alice", organizationId: "org", generation: sessionGeneration() };
    let resolve!: (view: SerializedView) => void;
    const request = new Promise<SerializedView>((done) => {
      resolve = done;
    });
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => request,
      onSuccess: (view) => storeProjectView(client, scope, "project", { view }),
    });
    const completion = mutation.execute(undefined);
    resetSessionScope();
    client.clear();
    const key = projectQueryKey("org", "project", nextUser);
    const current = { id: "project", views: [] } as unknown as SerializedProject;
    client.setQueryData(key, current);
    resolve({ id: "private", ownerId: "alice", visibility: "personal" } as SerializedView);
    await completion;
    expect(client.getQueryData(key)).toEqual(current);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("stores current saves only in their owner's cache", () => {
    const client = new QueryClient();
    const scope = { userId: "alice", organizationId: "org", generation: sessionGeneration() };
    const alice = projectQueryKey("org", "project", "alice");
    const bob = projectQueryKey("org", "project", "bob");
    client.setQueryData(alice, { views: [] });
    client.setQueryData(bob, { views: [] });
    const view = { id: "private", ownerId: "alice", visibility: "personal" } as SerializedView;
    storeProjectView(client, scope, "project", { view });
    expect(client.getQueryData(alice)).toEqual({ views: [view] });
    expect(client.getQueryData(bob)).toEqual({ views: [] });
    client.clear();
  });
});
