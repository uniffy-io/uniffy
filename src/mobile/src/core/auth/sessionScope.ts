let generation = 0;

export function sessionGeneration(): number {
  return generation;
}

export function resetSessionScope(): void {
  generation += 1;
}

export function isCurrentSession(captured: number): boolean {
  return captured === generation;
}
