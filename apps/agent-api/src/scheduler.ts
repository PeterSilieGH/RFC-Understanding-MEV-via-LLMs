interface Job {
  key?: string;
  task: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
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

  run(key: string | undefined, task: () => Promise<void>, onQueued: () => void): Promise<void> {
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
      void job
        .task()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          if (job.key) this.activeKeys.delete(job.key);
          this.drain();
        });
    }
  }
}
