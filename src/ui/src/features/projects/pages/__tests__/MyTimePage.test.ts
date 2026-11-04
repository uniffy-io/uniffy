import { expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import { MyTimePage } from "@/features/projects/pages/MyTimePage";
import { initialTimeState } from "@/features/projects/store/timeSlice";

const fixture = vi.hoisted(() => ({
  params: new URLSearchParams(),
  state: null as unknown as RootState,
  setSearchParams: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: () => {},
}));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [fixture.params, fixture.setSearchParams],
}));
vi.mock("@/app/hooks", () => ({
  useAppSelector: (select: (state: RootState) => unknown) => select(fixture.state),
  useAppDispatch: () => vi.fn(),
}));
vi.mock("@/components/layout/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/shared/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/features/projects/components/time/MyTimeWeek", () => ({ MyTimeWeek: () => null }));
vi.mock("@/features/projects/components/time/ApprovalsInbox", () => ({
  ApprovalsInbox: () => null,
}));

it("updates the visible week from notification URLs without discarding week drafts", () => {
  fixture.state = { time: initialTimeState, zenMode: { isActive: false } } as RootState;
  fixture.params = new URLSearchParams("day=2026-10-26");
  const current = MyTimePage().props.children[1].props.children;
  fixture.params = new URLSearchParams("day=2026-10-19");
  const historical = MyTimePage().props.children[1].props.children;
  expect(historical.props.day).toBe("2026-10-19");
  expect(historical.type).toBe(current.type);
  expect(historical.key).toBe(current.key);
});

it("stores week navigation in the return URL and restores it on remount", () => {
  fixture.state = { time: initialTimeState, zenMode: { isActive: false } } as RootState;
  fixture.params = new URLSearchParams("tab=week");
  const week = MyTimePage().props.children[1].props.children;
  week.props.onDayChange("2026-10-26");
  const [params, options] = fixture.setSearchParams.mock.lastCall!;
  expect(params.get("tab")).toBe("week");
  expect(params.get("day")).toBe("2026-10-26");
  expect(options).toEqual({ replace: true });
  fixture.params = new URLSearchParams(params.toString());
  const restored = MyTimePage().props.children[1].props.children;
  expect(restored.props.day).toBe("2026-10-26");
});

it("passes changed notification periods to the still-visible approvals inbox", () => {
  fixture.state = {
    time: {
      ...initialTimeState,
      policy: { approvalsEnabled: true },
      reviewEligibility: { eligible: true, loaded: true, loading: false },
    },
    zenMode: { isActive: false },
  } as RootState;
  fixture.params = new URLSearchParams("tab=approvals&period=2026-10-26");
  const current = MyTimePage().props.children[1].props.children;
  fixture.params = new URLSearchParams("tab=approvals&period=2026-10-19");
  const historical = MyTimePage().props.children[1].props.children;
  expect(historical.type).toBe(current.type);
  expect(historical.props.initialDay).toBe("2026-10-19");
});
