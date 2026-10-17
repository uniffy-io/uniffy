import { expect, it } from "vitest";
import {
  COMPOSITION_HOLD_MS,
  createCompositionTracker,
} from "@features/notes/realtime/composition";

it("composes while a word grows and stops at a separator", () => {
  const tracker = createCompositionTracker();
  tracker.textChanged("hello ", "hello w", 1000);
  expect(tracker.isComposing(1100)).toBe(true);
  tracker.textChanged("hello w", "hello wo", 1200);
  expect(tracker.isComposing(1300)).toBe(true);
  tracker.textChanged("hello wo", "hello wo ", 1400);
  expect(tracker.isComposing(1400)).toBe(false);
  tracker.textChanged("hello wo ", "hello wo \n", 1500);
  expect(tracker.isComposing(1500)).toBe(false);
});

it("keeps composing through a backspace inside the word", () => {
  const tracker = createCompositionTracker();
  tracker.textChanged("hello wor", "hello worl", 0);
  tracker.textChanged("hello worl", "hello wor", 10);
  expect(tracker.isComposing(20)).toBe(true);
  tracker.textChanged("hello wor", "hello", 30);
  expect(tracker.isComposing(40)).toBe(true);
  tracker.textChanged("hello", "hell", 50);
  tracker.textChanged("hell", "", 60);
  expect(tracker.isComposing(70)).toBe(false);
});

it("accepts the keystroke selection in either event order and ends on a caret move", () => {
  const tracker = createCompositionTracker();
  tracker.textChanged("ab", "abc", 0);
  tracker.selectionChanged(3, 3);
  expect(tracker.isComposing(1)).toBe(true);
  tracker.selectionChanged(4, 4);
  tracker.textChanged("abc", "abcd", 2);
  expect(tracker.isComposing(3)).toBe(true);
  tracker.selectionChanged(1, 1);
  expect(tracker.isComposing(4)).toBe(false);
  tracker.textChanged("abcd", "abcde", 5);
  tracker.selectionChanged(2, 5);
  expect(tracker.isComposing(6)).toBe(false);
});

it("expires after the hold and clears on reset", () => {
  const tracker = createCompositionTracker();
  tracker.textChanged("", "w", 1000);
  expect(tracker.isComposing(1000 + COMPOSITION_HOLD_MS - 1)).toBe(true);
  expect(tracker.isComposing(1000 + COMPOSITION_HOLD_MS)).toBe(false);
  tracker.textChanged("w", "wo", 5000);
  tracker.reset();
  expect(tracker.isComposing(5001)).toBe(false);
});

it("treats letters of any script as word characters", () => {
  const tracker = createCompositionTracker();
  tracker.textChanged("", "日", 0);
  expect(tracker.isComposing(1)).toBe(true);
  tracker.textChanged("日", "日本", 2);
  expect(tracker.isComposing(3)).toBe(true);
  tracker.textChanged("日本", "日本。", 4);
  expect(tracker.isComposing(5)).toBe(false);
});
