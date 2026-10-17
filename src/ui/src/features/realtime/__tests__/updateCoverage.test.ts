import { describe, expect, it } from "vitest";
import {
  MESSAGE_ACCEPTED_RECEIPT,
  MESSAGE_CHECKPOINT_PROGRESS,
  MESSAGE_SESSION_STATE,
  decodeAcceptedReceipt,
  decodeCheckpointProgress,
  decodeSessionState,
} from "@/features/realtime/protocol";
import {
  UpdateCoverage,
  type Coverage,
  type CoverageTransition,
} from "@/features/realtime/updateCoverage";
import { fromHex, wireCorpus, type CorpusStep } from "@/features/realtime/__tests__/wireCorpus";

const GENERATION = "3f9c1a52-7d4e-4b8a-9c61-0e2f5d8b7a14";

function applyFrame(coverage: UpdateCoverage, type: number, frame: Uint8Array) {
  if (type === MESSAGE_ACCEPTED_RECEIPT) return coverage.applyReceipt(decodeAcceptedReceipt(frame));
  if (type === MESSAGE_CHECKPOINT_PROGRESS)
    return coverage.applyProgress(decodeCheckpointProgress(frame));
  if (type === MESSAGE_SESSION_STATE) return coverage.applySessionState(decodeSessionState(frame));
  throw new Error(`no coverage meaning for message ${type}`);
}

function run(steps: CorpusStep[]) {
  const coverage = new UpdateCoverage();
  const transitions: CoverageTransition[] = [];
  steps.forEach((step, index) => {
    transitions.push(
      ...("local" in step
        ? coverage.add(step.local, index)
        : applyFrame(coverage, step.frame.type, fromHex(step.frame.hex))),
    );
  });
  const final: Record<string, Coverage> = {};
  for (const transition of transitions) final[transition.updateId] = transition.coverage;
  return { coverage, transitions, final };
}

function session(epoch: string, headSequence: number, checkpointSequence: number) {
  return { generation: GENERATION, epoch, headSequence, checkpointSequence, checkpointRevision: 1 };
}

function receipt(updateId: string, epoch: string, acceptedSequence: number) {
  return { updateId, generation: GENERATION, epoch, acceptedSequence };
}

describe("update coverage", () => {
  it.each(wireCorpus.sequences.map((sequence) => [sequence.name, sequence] as const))(
    "ends %s with the corpus coverage",
    (_, sequence) => {
      expect(run(sequence.steps).final).toEqual(sequence.coverage);
    },
  );

  it.each(wireCorpus.sequences.map((sequence) => [sequence.name, sequence] as const))(
    "ignores every duplicated frame of %s",
    (_, sequence) => {
      const doubled = sequence.steps.flatMap((step): CorpusStep[] =>
        "frame" in step ? [step, step] : [step],
      );
      const once = run(sequence.steps);
      const twice = run(doubled);
      expect(twice.final).toEqual(sequence.coverage);
      expect(twice.transitions.map(({ updateId, coverage }) => [updateId, coverage])).toEqual(
        once.transitions.map(({ updateId, coverage }) => [updateId, coverage]),
      );
    },
  );

  it("never lets progress for another generation or epoch cover an update", () => {
    const coverage = new UpdateCoverage();
    coverage.applySessionState(session("E1", 0, 0));
    coverage.add("edit", 1);
    coverage.applyReceipt(receipt("edit", "E1", 1));
    const foreign = [
      { generation: "other", epoch: "E1", coveredSequence: 9, checkpointRevision: 2 },
      { generation: GENERATION, epoch: "E0", coveredSequence: 9, checkpointRevision: 2 },
    ];
    for (const progress of foreign) expect(coverage.applyProgress(progress)).toEqual([]);
    expect(coverage.summary().checkpointPending).toBe(true);
    expect(coverage.applyReceipt(receipt("edit", "E0", 1))).toEqual([]);
  });

  it("checkpoints a committed update whatever epoch accepted it", () => {
    const coverage = new UpdateCoverage();
    coverage.add("before-session", 1);
    expect(coverage.applyCommitted("before-session")).toEqual([
      { updateId: "before-session", coverage: "checkpointed", editedAt: 1 },
    ]);
    coverage.applySessionState(session("E1", 0, 0));
    coverage.add("edit", 2);
    coverage.applyReceipt(receipt("edit", "E1", 1));
    coverage.applySessionState(session("E2", 0, 0));
    expect(coverage.applyCommitted("edit")).toEqual([
      { updateId: "edit", coverage: "checkpointed", editedAt: 2 },
    ]);
    expect(coverage.applyCommitted("edit")).toEqual([]);
    expect(coverage.summary().checkpointPending).toBe(false);
  });

  it("returns an accepted update beyond the server head to local", () => {
    const coverage = new UpdateCoverage();
    coverage.applySessionState(session("E1", 0, 0));
    coverage.add("kept", 1);
    coverage.add("lost", 2);
    coverage.applyReceipt(receipt("kept", "E1", 1));
    coverage.applyReceipt(receipt("lost", "E1", 2));
    expect(coverage.applySessionState(session("E1", 1, 0))).toEqual([
      { updateId: "lost", coverage: "local", editedAt: 2 },
    ]);
    expect(coverage.localIds()).toEqual(["lost"]);
  });

  it("summarizes transport and checkpoint pending with the oldest uncheckpointed edit", () => {
    const coverage = new UpdateCoverage();
    expect(coverage.summary()).toEqual({
      transportPending: false,
      checkpointPending: false,
      oldestUncheckpointedAt: null,
    });
    coverage.applySessionState(session("E1", 0, 0));
    coverage.add("first", 100);
    coverage.add("second", 200);
    coverage.applyReceipt(receipt("first", "E1", 1));
    expect(coverage.summary()).toEqual({
      transportPending: true,
      checkpointPending: true,
      oldestUncheckpointedAt: 100,
    });
    coverage.applyReceipt(receipt("second", "E1", 2));
    coverage.applyProgress({
      generation: GENERATION,
      epoch: "E1",
      coveredSequence: 1,
      checkpointRevision: 2,
    });
    expect(coverage.summary()).toEqual({
      transportPending: false,
      checkpointPending: true,
      oldestUncheckpointedAt: 200,
    });
  });

  it("reconciles a restored receipt against the next session state", () => {
    const coverage = new UpdateCoverage();
    const held = { generation: GENERATION, epoch: "E1", sequence: 3 };
    const lost = { generation: GENERATION, epoch: "E0", sequence: 7 };
    expect(coverage.add("held", 1, held)).toEqual([
      { updateId: "held", coverage: "accepted", editedAt: 1, receipt: held },
    ]);
    coverage.add("lost", 2, lost);
    expect(coverage.applySessionState(session("E1", 5, 2))).toEqual([
      { updateId: "lost", coverage: "local", editedAt: 2 },
    ]);
    expect(coverage.add("covered", 3, { ...held, sequence: 2 })).toEqual([
      { updateId: "covered", coverage: "checkpointed", editedAt: 3 },
    ]);
    expect(
      coverage.applyProgress({
        generation: GENERATION,
        epoch: "E1",
        coveredSequence: 3,
        checkpointRevision: 4,
      }),
    ).toEqual([{ updateId: "held", coverage: "checkpointed", editedAt: 1 }]);
  });

  it("replays a receipt restored after session state when it lies above the session head", () => {
    const coverage = new UpdateCoverage();
    coverage.applySessionState(session("E1", 3, 2));
    const lost = { generation: GENERATION, epoch: "E1", sequence: 5 };
    const held = { generation: GENERATION, epoch: "E1", sequence: 3 };
    expect(coverage.add("lost", 1, lost)).toEqual([
      { updateId: "lost", coverage: "local", editedAt: 1 },
    ]);
    expect(coverage.add("held", 2, held)).toEqual([
      { updateId: "held", coverage: "accepted", editedAt: 2, receipt: held },
    ]);
    // Another writer's edit took sequence 5 after the loss; its checkpoint must not retire ours.
    expect(
      coverage.applyProgress({
        generation: GENERATION,
        epoch: "E1",
        coveredSequence: 5,
        checkpointRevision: 3,
      }),
    ).toEqual([{ updateId: "held", coverage: "checkpointed", editedAt: 2 }]);
    expect(coverage.localIds()).toEqual(["lost"]);
  });
});
