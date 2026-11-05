export type SnapshotLoader = () => Promise<() => boolean | void>;
type Work = {
  load: SnapshotLoader;
  revision: number;
  attempts: number;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/** Bounds recovery reads and never applies a snapshot crossed by a live mutation. */
export class RecoveryQueue {
  private work = new Map<string, Work>();
  private active = 0;
  private stopped = false;
  constructor(
    private readonly current: () => boolean,
    private readonly concurrency = 3,
  ) {}
  request(key: string, load: SnapshotLoader) {
    if (this.stopped) return;
    const existing = this.work.get(key);
    if (existing) {
      existing.load = load;
      existing.revision++;
    } else this.work.set(key, { load, revision: 0, attempts: 0, running: false });
    this.pump();
  }
  get pending(): boolean {
    return this.work.size > 0;
  }
  changed(key: string): boolean {
    const work = this.work.get(key);
    if (!work) return false;
    work.revision++;
    return true;
  }
  stop() {
    this.stopped = true;
    for (const work of this.work.values()) clearTimeout(work.timer);
    this.work.clear();
  }
  private pump() {
    if (this.stopped || !this.current()) return;
    for (const [key, work] of this.work) {
      if (this.active >= this.concurrency) break;
      if (work.running || work.timer) continue;
      work.running = true;
      this.active++;
      void this.run(key, work);
    }
  }
  private async run(key: string, work: Work) {
    const revision = work.revision;
    let retry = false;
    let failed = false;
    try {
      const apply = await work.load();
      if (this.stopped || !this.current()) return;
      retry = revision !== work.revision || apply() === false;
    } catch {
      retry = true;
      failed = true;
    } finally {
      work.running = false;
      this.active--;
      if (!this.stopped && this.current()) {
        if (retry) {
          work.attempts++;
          const delay = Math.min(failed ? 30000 : 1000, 250 * 2 ** Math.min(work.attempts, 7));
          work.timer = setTimeout(
            () => {
              work.timer = undefined;
              this.pump();
            },
            delay * (0.75 + Math.random() * 0.5),
          );
        } else this.work.delete(key);
        this.pump();
      }
    }
  }
}

export class StreamPosition {
  private id = "";
  private sequence = 0n;
  observe(id: string, sequence: bigint): "new" | "gap" | "next" | "duplicate" {
    if (!id) return "next";
    if (id !== this.id) {
      this.id = id;
      this.sequence = sequence;
      return "new";
    }
    if (sequence <= this.sequence) return "duplicate";
    const gap = sequence !== this.sequence + 1n;
    this.sequence = sequence;
    return gap ? "gap" : "next";
  }
}
