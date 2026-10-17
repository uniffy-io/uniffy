import { expect, it } from "vitest";
import {
  MESSAGE_ACCEPTED_RECEIPT,
  MESSAGE_CHECKPOINT_PROGRESS,
  MESSAGE_SESSION_STATE,
  decodeAcceptedReceipt,
  decodeCheckpointProgress,
  decodeSessionState,
} from "@shared/realtime/protocol";
import {
  UpdateCoverage,
  type Coverage,
  type CoverageTransition,
} from "@shared/realtime/updateCoverage";
import { fromHex, wireCorpus, type CorpusSequence } from "@shared/realtime/__tests__/wireCorpus";

function apply(coverage: UpdateCoverage, step: CorpusSequence["steps"][number], at: number) {
  if ("local" in step) return coverage.add(step.local, at);
  const frame = fromHex(step.frame.hex);
  switch (step.frame.type) {
    case MESSAGE_ACCEPTED_RECEIPT:
      return coverage.applyReceipt(decodeAcceptedReceipt(frame));
    case MESSAGE_CHECKPOINT_PROGRESS:
      return coverage.applyProgress(decodeCheckpointProgress(frame));
    case MESSAGE_SESSION_STATE:
      return coverage.applySessionState(decodeSessionState(frame));
    default:
      throw new Error(`no coverage step for message ${step.frame.type}`);
  }
}

function record(log: Map<string, Coverage>, transitions: CoverageTransition[]) {
  for (const { updateId, coverage } of transitions) log.set(updateId, coverage);
}

const session = (epoch: string, headSequence = 0, checkpointSequence = 0) => ({
  generation: "g",
  epoch,
  headSequence,
  checkpointSequence,
  checkpointRevision: 1,
});
const receipt = (updateId: string, epoch: string, acceptedSequence: number, generation = "g") => ({
  updateId,
  generation,
  epoch,
  acceptedSequence,
});
const progress = (epoch: string, coveredSequence: number, generation = "g") => ({
  generation,
  epoch,
  coveredSequence,
  checkpointRevision: 2,
});

it.each(wireCorpus.sequences)("$name reaches the corpus coverage", (sequence) => {
  const coverage = new UpdateCoverage();
  const log = new Map<string, Coverage>();
  sequence.steps.forEach((step, index) => record(log, apply(coverage, step, index)));
  expect(Object.fromEntries(log)).toEqual(sequence.coverage);
});

it.each(wireCorpus.sequences)("$name ignores every duplicated step", (sequence) => {
  const coverage = new UpdateCoverage();
  const log = new Map<string, Coverage>();
  sequence.steps.forEach((step, index) => {
    record(log, apply(coverage, step, index));
    expect(apply(coverage, step, index)).toEqual([]);
  });
  expect(Object.fromEntries(log)).toEqual(sequence.coverage);
});

it("derives transport and checkpoint pending with the oldest uncheckpointed edit", () => {
  const coverage = new UpdateCoverage();
  coverage.applySessionState(session("e1"));
  coverage.add("a", 100);
  coverage.add("b", 200);
  expect(coverage.summary()).toEqual({
    transportPending: true,
    checkpointPending: true,
    oldestUncheckpointedAt: 100,
  });
  coverage.applyReceipt(receipt("a", "e1", 1));
  coverage.applyReceipt(receipt("b", "e1", 2));
  expect(coverage.summary()).toEqual({
    transportPending: false,
    checkpointPending: true,
    oldestUncheckpointedAt: 100,
  });
  coverage.applyProgress(progress("e1", 1));
  expect(coverage.summary().oldestUncheckpointedAt).toBe(200);
  coverage.applyProgress(progress("e1", 2));
  expect(coverage.summary()).toEqual({
    transportPending: false,
    checkpointPending: false,
    oldestUncheckpointedAt: null,
  });
});

it("never lets frames for another generation or epoch, or older progress, change coverage", () => {
  const coverage = new UpdateCoverage();
  coverage.applySessionState(session("e1"));
  coverage.add("a", 1);
  expect(coverage.applyReceipt(receipt("a", "e1", 1, "other"))).toEqual([]);
  expect(coverage.applyReceipt(receipt("a", "e0", 1))).toEqual([]);
  expect(coverage.applyReceipt(receipt("a", "e1", 2))).toEqual([
    { updateId: "a", coverage: "accepted", editedAt: 1 },
  ]);
  expect(coverage.applyProgress(progress("e1", 9, "other"))).toEqual([]);
  expect(coverage.applyProgress(progress("e0", 9))).toEqual([]);
  expect(coverage.applyProgress(progress("e1", 1))).toEqual([]);
  expect(coverage.summary()).toMatchObject({ transportPending: false, checkpointPending: true });
});

it("returns accepted updates to local when session state shows a head below their receipt", () => {
  const coverage = new UpdateCoverage();
  coverage.applySessionState(session("e1", 4, 4));
  coverage.add("kept", 1);
  coverage.add("lost", 2);
  coverage.applyReceipt(receipt("kept", "e1", 5));
  coverage.applyReceipt(receipt("lost", "e1", 6));
  expect(coverage.applySessionState(session("e1", 5, 4))).toEqual([
    { updateId: "lost", coverage: "local", editedAt: 2 },
  ]);
  expect(coverage.localIds()).toEqual(["lost"]);
  expect(coverage.applySessionState(session("e1", 5, 5))).toEqual([
    { updateId: "kept", coverage: "checkpointed", editedAt: 1 },
  ]);
});

it("treats message 7 as committed in any epoch and ignores it once checkpointed", () => {
  const coverage = new UpdateCoverage();
  coverage.applySessionState(session("e1"));
  coverage.add("a", 1);
  coverage.add("b", 2);
  coverage.applyReceipt(receipt("a", "e1", 1));
  coverage.applySessionState(session("e2"));
  expect(coverage.applyCommitted("a")).toEqual([
    { updateId: "a", coverage: "checkpointed", editedAt: 1 },
  ]);
  expect(coverage.applyCommitted("b")).toEqual([
    { updateId: "b", coverage: "checkpointed", editedAt: 2 },
  ]);
  expect(coverage.applyCommitted("a")).toEqual([]);
  expect(coverage.applyReceipt(receipt("a", "e2", 1))).toEqual([]);
  expect(coverage.summary().checkpointPending).toBe(false);
});
