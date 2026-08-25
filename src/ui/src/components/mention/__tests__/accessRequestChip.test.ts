import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MentionChip, MentionChipCompact } from "@/components/mention/MentionChip";
import {
  MentionAccessRequestStatus,
  MentionAvailability,
  type MentionLiveState,
} from "@/components/mention/types";
import { isMentionInteractiveTarget } from "@/components/editor/plugins/mention";
import { UrnMetadataSchema } from "@uniffy/proto/search/v1/search_pb";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  fetchPreview: vi.fn(),
  useMentionState: vi.fn(() => null),
  display: "expanded",
}));

vi.mock("@/app/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ auth: { currentOrganizationId: "org-1", user: { id: "user-1" } } }),
}));

vi.mock("@/components/mention/useMentionState", () => ({
  useMentionState: mocks.useMentionState,
  useMentionDisplay: () => mocks.display,
}));

vi.mock("@/components/editor/plugins/mention/useUrnPreview", () => ({
  useUrnPreview: () => ({
    preview: null,
    isLoading: false,
    error: null,
    fetchPreview: mocks.fetchPreview,
  }),
}));

vi.mock("@/components/mention/useBatchedSubjectResolver", () => ({
  resolveUrnBatched: vi.fn(),
}));

const URN = "urn:uniffy:content:NOTE:019fc01f-12b6-7f11-a7f1-a3197c6cefca";

function renderChip(liveState: MentionLiveState): string {
  return renderToStaticMarkup(
    createElement(MentionChip, {
      urn: URN,
      label: "Stored note label",
      liveState,
      onClick: vi.fn(),
    }),
  );
}

describe("mention access states", () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.fetchPreview.mockReset();
    mocks.useMentionState.mockClear();
    mocks.display = "expanded";
  });

  it("passes resolved metadata into mention-state registration", () => {
    const resolvedMetadata = create(UrnMetadataSchema, {
      title: "Authorized title",
      url: "/notes/authorized",
    });

    renderToStaticMarkup(
      createElement(MentionChip, {
        urn: URN,
        label: "Stored note label",
        resolvedMetadata,
      }),
    );

    expect(mocks.useMentionState).toHaveBeenCalledWith(URN, resolvedMetadata);
  });

  it("renders an expanded restricted card from the stored label only", () => {
    const markup = renderChip({
      urn: URN,
      title: "Private live title",
      availability: MentionAvailability.Restricted,
      canRequestAccess: true,
    });

    expect(markup).toContain("Stored note label");
    expect(markup).toContain(">Note<");
    expect(markup).toContain(">Restricted<");
    expect(markup).toContain("Request access");
    expect(markup).not.toContain("Private live title");
    expect(markup).not.toContain('role="link"');
    expect(mocks.fetchPreview).not.toHaveBeenCalled();
  });

  it("renders compact and pending request variants as buttons", () => {
    const compact = renderToStaticMarkup(
      createElement(MentionChipCompact, {
        urn: URN,
        label: "Stored note label",
        liveState: {
          urn: URN,
          availability: MentionAvailability.Restricted,
          canRequestAccess: true,
          accessRequestStatus: MentionAccessRequestStatus.Pending,
          accessRequestId: "request-1",
        },
      }),
    );

    expect(compact).toContain("<button");
    expect(compact).toContain("Access requested");
    expect(compact).not.toContain('role="link"');
  });

  it("leaves request buttons to the NodeView instead of navigating the mention", () => {
    const requestButton = {
      closest: (selector: string) => (selector === "button" ? ({} as Element) : null),
    };
    const chipBody = { closest: () => null };

    expect(isMentionInteractiveTarget(requestButton)).toBe(true);
    expect(isMentionInteractiveTarget(chipBody)).toBe(false);
  });

  it("keeps genuine deletions as privacy-safe tombstones", () => {
    const markup = renderChip({
      urn: URN,
      availability: MentionAvailability.Deleted,
      canRequestAccess: false,
    });

    expect(markup).toContain("Deleted note");
    expect(markup).not.toContain("Stored note label");
    expect(markup).not.toContain("Request access");
  });

  it("renders an unavailable retry without treating the target as deleted", () => {
    const markup = renderChip({
      urn: URN,
      availability: MentionAvailability.Unavailable,
      canRequestAccess: false,
    });

    expect(markup).toContain("Stored note label");
    expect(markup).toContain("Retry");
    expect(markup).not.toContain("Deleted note");
    expect(markup).not.toContain('role="link"');
  });
});
