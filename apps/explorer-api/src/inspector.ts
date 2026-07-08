import { execFile } from "node:child_process";
import { loadConfig } from "@mev/config";
import { pool } from "@mev/db";

const config = loadConfig();

const inFlight = new Map<number, Promise<string>>();

export async function isInspected(blockNumber: number): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM blocks WHERE block_number = $1", [blockNumber]);
  return (result.rowCount ?? 0) > 0;
}

// The spawned container runs on the host docker daemon with host networking,
// so it reaches postgres via the host-published port regardless of whether
// this process runs in compose or bare.
function runInspectContainer(blockNumber: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "host",
        "-e",
        `POSTGRES_USER=${config.POSTGRES_USER}`,
        "-e",
        `POSTGRES_PASSWORD=${config.POSTGRES_PASSWORD}`,
        "-e",
        "POSTGRES_HOST=localhost",
        "-e",
        `POSTGRES_DB=${config.POSTGRES_DB}`,
        "-e",
        `RPC_URL=${config.RPC_URL}`,
        "-w",
        "/app",
        config.MEV_INSPECT_IMAGE,
        "cli.py",
        "inspect-block-command",
        String(blockNumber),
      ],
      { timeout: 5 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`mev-inspect failed: ${stderr || error.message}`));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

export async function inspectBlockIfNeeded(
  blockNumber: number,
): Promise<{ alreadyInspected: boolean }> {
  if (await isInspected(blockNumber)) {
    return { alreadyInspected: true };
  }

  const existing = inFlight.get(blockNumber);
  if (existing) {
    await existing;
    return { alreadyInspected: true };
  }

  const promise = runInspectContainer(blockNumber).finally(() => {
    inFlight.delete(blockNumber);
  });
  inFlight.set(blockNumber, promise);

  try {
    await promise;
  } catch (err) {
    // mev-inspect-py can fail on its optional USD-summary step (no price
    // feed configured) after it has already committed the MEV data we
    // actually need - only surface the error if the block truly wasn't saved.
    if (!(await isInspected(blockNumber))) {
      throw err;
    }
  }
  return { alreadyInspected: false };
}
