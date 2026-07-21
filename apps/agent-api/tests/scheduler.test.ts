import { describe, expect, it } from "vitest";
import { RunScheduler } from "../src/scheduler.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("analysis scheduler", () => {
  it("runs independent work up to its bound", async () => {
    const scheduler = new RunScheduler(2);
    const gates = [deferred(), deferred(), deferred()];
    let active = 0;
    let peak = 0;
    const runs = gates.map((gate) =>
      scheduler.run(
        undefined,
        async () => {
          active++;
          peak = Math.max(peak, active);
          await gate.promise;
          active--;
        },
        () => {},
      ),
    );
    await Promise.resolve();
    expect(active).toBe(2);
    gates[0].resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(active).toBe(2);
    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  it("serializes work sharing a persistent-session key", async () => {
    const scheduler = new RunScheduler(2);
    const first = deferred();
    const order: string[] = [];
    const a = scheduler.run(
      "session",
      async () => {
        order.push("a:start");
        await first.promise;
        order.push("a:end");
      },
      () => {},
    );
    const b = scheduler.run(
      "session",
      async () => {
        order.push("b");
      },
      () => {},
    );
    const independent = scheduler.run(
      "other",
      async () => {
        order.push("other");
      },
      () => {},
    );
    await Promise.resolve();
    expect(order).toEqual(["a:start", "other"]);
    first.resolve();
    await Promise.all([a, b, independent]);
    expect(order).toEqual(["a:start", "other", "a:end", "b"]);
  });

  it("emits queued only when work cannot start immediately", async () => {
    const scheduler = new RunScheduler(1);
    const gate = deferred();
    let queued = 0;
    const first = scheduler.run(
      undefined,
      () => gate.promise,
      () => queued++,
    );
    const second = scheduler.run(
      undefined,
      async () => {},
      () => queued++,
    );
    expect(queued).toBe(1);
    gate.resolve();
    await Promise.all([first, second]);
  });
});
