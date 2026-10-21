import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ListNotesResponseSchema, NoteSchema } from "@uniffy/proto/notes/v1/notes_pb";
import type { RootState } from "@/app/store";
import { notesApi } from "@/features/notes/api/notesApi";
import { initializeNotesData } from "@/features/notes/store/notesThunks";

vi.mock("@/features/notes/api/notesApi", () => ({ notesApi: { listNotes: vi.fn() } }));

type ListNotes = typeof notesApi.listNotes;
type ListNotesResult = Awaited<ReturnType<ListNotes>>;

/** The store as the thunk reads it in one organization's tab, before any tree loaded. */
function signedInto(organizationId: string): RootState {
  return {
    auth: { currentOrganizationId: organizationId, user: { id: "alice" } },
    notesTree: { treeLoaded: false },
    notes: { notes: {}, pagination: { totalCount: 0 } },
  } as unknown as RootState;
}

function pageOf(organizationId: string, noteId: string): ListNotesResult {
  return create(ListNotesResponseSchema, {
    notes: [create(NoteSchema, { id: noteId, organizationId, title: noteId })],
    totalCount: 1,
    totalPages: 1,
  }) as ListNotesResult;
}

/** Each organization's list request waits until the test answers it. */
function holdListRequests(): Map<string, (page: ListNotesResult) => void> {
  const answers = new Map<string, (page: ListNotesResult) => void>();
  vi.mocked(notesApi.listNotes).mockImplementation(
    ((request: { organizationId: string }) =>
      new Promise<ListNotesResult>((resolve) =>
        answers.set(request.organizationId, resolve),
      )) as unknown as ListNotes,
  );
  return answers;
}

afterEach(() => vi.mocked(notesApi.listNotes).mockReset());

describe("initializeNotesData", () => {
  it("loads the organization a tab switched to while the previous one's load is in flight", async () => {
    const answers = holdListRequests();
    let state = signedInto("org-1");
    const getState = () => state;
    const dispatch = vi.fn();
    const first = initializeNotesData()(dispatch, getState, undefined);
    await vi.waitFor(() => expect(answers.has("org-1")).toBe(true));

    state = signedInto("org-2");
    const second = initializeNotesData()(dispatch, getState, undefined);
    await vi.waitFor(() => expect(answers.has("org-2")).toBe(true));
    answers.get("org-2")?.(pageOf("org-2", "second-org-note"));
    answers.get("org-1")?.(pageOf("org-1", "first-org-note"));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(initializeNotesData.fulfilled.match(secondResult)).toBe(true);
    expect(
      (secondResult.payload as { notes: { id: string; organizationId: string }[] }).notes,
    ).toMatchObject([{ id: "second-org-note", organizationId: "org-2" }]);
    expect((firstResult.payload as { notes: { id: string }[] }).notes.map(({ id }) => id)).toEqual([
      "first-org-note",
    ]);
  });

  it("shares one in-flight load between calls of the same organization", async () => {
    const answers = holdListRequests();
    const state = signedInto("org-1");
    const dispatch = vi.fn();
    const first = initializeNotesData()(dispatch, () => state, undefined);
    await vi.waitFor(() => expect(answers.has("org-1")).toBe(true));
    const second = initializeNotesData()(dispatch, () => state, undefined);
    answers.get("org-1")?.(pageOf("org-1", "shared-note"));

    const results = await Promise.all([first, second]);
    expect(notesApi.listNotes).toHaveBeenCalledOnce();
    for (const result of results)
      expect((result.payload as { notes: { id: string }[] }).notes.map(({ id }) => id)).toEqual([
        "shared-note",
      ]);
  });
});
