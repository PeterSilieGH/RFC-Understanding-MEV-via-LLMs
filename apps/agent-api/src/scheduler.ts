interface Job {
  key?: string;
  task: (permit: ProviderPermit) => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * A permit represents one slot in the process-wide provider concurrency cap.
 *
 * A pi parent is paused while one of its tools executes, so a direct child can
 * reuse that same provider slot. `runChild` models the hand-off explicitly: it
 * does not enqueue (and therefore cannot deadlock at limit 1), and it rejects a
 * recursive/nested hand-off. The permit is returned to the parent in `finally`.
 */
export interface ProviderPermit {
  runChild<T>(task: () => Promise<T>): Promise<T>;
}

class ProviderPermitImpl implements ProviderPermit {
  private childActive = false;

  async runChild<T>(task: () => Promise<T>): Promise<T> {
    if (this.childActive) {
      throw new Error("nested provider child runs are not allowed");
    }
    this.childActive = true;
    try {
      return await task();
    } finally {
      this.childActive = false;
    }
  }
}

/** Bounded FIFO scheduler. Independent jobs may overlap, but jobs sharing a
 * persistent-session key never do because a pi session is not re-entrant. */
export class RunScheduler {
  private active = 0;
  private readonly activeKeys = new Set<string>();
  private readonly waiting: Job[] = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("analysis concurrency must be a positive integer");
    }
  }

  run(
    key: string | undefined,
    task: (permit: ProviderPermit) => Promise<void>,
    onQueued: () => void,
  ): Promise<void> {
    const canStartNow =
      this.active < this.limit && (!key || !this.activeKeys.has(key)) && this.waiting.length === 0;
    if (!canStartNow) onQueued();

    return new Promise<void>((resolve, reject) => {
      this.waiting.push({ key, task, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.limit) {
      const index = this.waiting.findIndex((job) => !job.key || !this.activeKeys.has(job.key));
      if (index === -1) return;
      const [job] = this.waiting.splice(index, 1);
      this.active++;
      if (job.key) this.activeKeys.add(job.key);
      const permit = new ProviderPermitImpl();
      void job
        .task(permit)
        .then(
          () => this.complete(job),
          (error) => this.complete(job, error),
        );
    }
  }

  private complete(job: Job, error?: unknown): void {
    try {
      if (error === undefined) job.resolve();
      else job.reject(error);
    } finally {
          this.active--;
          if (job.key) this.activeKeys.delete(job.key);
          this.drain();
    }
  }

  /** Test/operations gauge. A child reuses its parent's slot. */
  get activeProviderSlots(): number {
    return this.active;
  }
}
