import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  RealtimeBufferPreflightSchema,
  RealtimeBufferStatusSchema,
  RealtimeBufferTotalsSchema,
  RealtimeBufferVerdict,
} from "@uniffy/proto/superadmin/v1/system_config_pb";
import { RealtimeBufferCard } from "@/features/platform/components/RealtimeBufferCard";

const MIB = 1024n * 1024n;
const LOSS_WINDOW = "AOF fsync everysec: a crash loses about one second of accepted edits";

interface StatusOverrides {
  verdict?: RealtimeBufferVerdict;
  pendingBudgetFromEnv?: boolean;
  preflight?: MessageInitShape<typeof RealtimeBufferPreflightSchema>;
  totals?: MessageInitShape<typeof RealtimeBufferTotalsSchema>;
}

function status(overrides: StatusOverrides = {}) {
  return create(RealtimeBufferStatusSchema, {
    verdict: RealtimeBufferVerdict.ENABLED,
    preflightMode: "strict",
    pendingBudgetFromEnv: false,
    preflight: {
      evictionPolicy: "noeviction",
      maxmemoryBytes: 0n,
      aofEnabled: true,
      rdbSnapshotsConfigured: true,
      lossWindow: LOSS_WINDOW,
      valkeyVersion: "9.1.2",
      valkeyRunIdPrefix: "565deefd",
      pendingBudgetBytes: 256n * MIB,
    },
    totals: {
      pendingBytes: MIB,
      pendingRecords: 7n,
      pendingDocuments: 2n,
      oldestPendingSeconds: 12.4,
    },
    epochResets: { identity_changed: 2n, gap: 1n },
    poisonedCheckpoints: { undecodable: 5n },
    ...overrides,
  });
}

function render(
  reading: ReturnType<typeof status> | null,
  { stale = false }: { stale?: boolean } = {},
): string {
  return renderToStaticMarkup(
    createElement(RealtimeBufferCard, { status: reading, stale, pollSeconds: 15 }),
  );
}

describe("realtime buffer card", () => {
  it("shows the verdict and the pending totals against the budget", () => {
    const html = render(status());

    expect(html).toContain(">Accepting edits<");
    expect(html).toContain(">1 MB of 256 MB<");
    expect(html).toContain(">7<");
    expect(html).toContain(">2<");
    expect(html).toContain(">12s<");
    expect(html).toContain("Refreshes every 15 seconds.");
  });

  it("lists the preflight facts operators cannot read from env", () => {
    const html = render(status());

    expect(html).toContain(">noeviction<");
    expect(html).toContain(">Unlimited<");
    expect(html).toContain(LOSS_WINDOW);
    expect(html).toContain(">9.1.2, run 565deefd<");
    expect(html).toContain(">256 MB, from maxmemory<");
    expect(html).toContain(">strict<");
  });

  it("sums epoch resets and poisoned checkpoints and names their reasons", () => {
    const html = render(status());

    expect(html).toContain('title="identity_changed: 2, gap: 1">3<');
    expect(html).toContain('title="undecodable: 5">5<');
  });

  it("names the policy and the switch when strict mode refuses edits", () => {
    const refused = status({
      verdict: RealtimeBufferVerdict.DISABLED,
      preflight: { evictionPolicy: "allkeys-lru", lossWindow: LOSS_WINDOW },
    });

    const html = render(refused);

    expect(html).toContain(">Refusing edits<");
    expect(html).toContain("maxmemory-policy allkeys-lru can evict pending edits");
    expect(html).toContain("REALTIME_VALKEY_PREFLIGHT=warn");
  });

  it("says an unreadable policy is accepted unchecked", () => {
    const html = render(
      status({ verdict: RealtimeBufferVerdict.UNKNOWN, preflight: { lossWindow: LOSS_WINDOW } }),
    );

    expect(html).toContain(">Policy unknown<");
    expect(html).toContain(">Unreadable<");
  });

  it("reports Not checked with bare totals before the backend reached Valkey", () => {
    const html = render(status({ verdict: RealtimeBufferVerdict.NOT_RUN, preflight: undefined }));

    expect(html).toContain(">Not checked<");
    expect(html).toContain(">1 MB<");
    expect(html).not.toContain("Eviction policy");
  });

  it("names the budget setting when env sets it", () => {
    expect(render(status({ pendingBudgetFromEnv: true }))).toContain(
      ">256 MB, set by REALTIME_PENDING_BUDGET_BYTES<",
    );
  });

  it("keeps the verdict when Valkey cannot be read for one refresh", () => {
    const html = render(status({ totals: undefined }));

    expect(html).toContain(">Accepting edits<");
    expect(html).toContain("pending totals are unavailable");
    expect(html).not.toContain("Oldest edit");
  });

  it("reads None for the oldest edit when nothing is pending", () => {
    const idle = status({
      totals: { pendingBytes: 0n, pendingRecords: 0n, pendingDocuments: 0n },
    });

    expect(render(idle)).toContain(">None<");
  });

  it("says the last refresh failed while it shows the earlier reading", () => {
    expect(render(status(), { stale: true })).toContain(
      "The last refresh failed. Showing the reading before it.",
    );
    expect(render(null, { stale: true })).toContain("The buffer status could not be read.");
    expect(render(null)).toContain("Loading...");
  });
});
