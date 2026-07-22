import { describe, expect, it } from "vitest";
import {
  MIGRATION_ADVISORY_LOCK_ID,
  type Migration,
  type MigrationClient,
  type MigrationPool,
  checksumMigration,
  runMigrations,
} from "../src/migrations.js";

class TestDatabase {
  readonly applied = new Map<string, string>();
  readonly executed: string[] = [];
  readonly events: string[] = [];
  failSql: string | undefined;
  #locked = false;
  #waiters: Array<() => void> = [];

  async lock(): Promise<void> {
    if (!this.#locked) {
      this.#locked = true;
      return;
    }
    await new Promise<void>((resolve) => this.#waiters.push(resolve));
  }

  unlock(): void {
    const next = this.#waiters.shift();
    if (next) next();
    else this.#locked = false;
  }
}

class TestClient implements MigrationClient {
  #pending: [string, string] | undefined;
  constructor(private readonly database: TestDatabase) {}

  async query(text: string, values: unknown[] = []) {
    const normalized = text.trim();
    if (normalized.startsWith("SELECT pg_advisory_lock")) {
      expect(values).toEqual([MIGRATION_ADVISORY_LOCK_ID]);
      await this.database.lock();
      this.database.events.push("lock");
      return { rows: [] };
    }
    if (normalized.startsWith("SELECT pg_advisory_unlock")) {
      this.database.events.push("unlock");
      this.database.unlock();
      return { rows: [] };
    }
    if (normalized.startsWith("CREATE TABLE IF NOT EXISTS mev_schema_migrations")) {
      return { rows: [] };
    }
    if (normalized.startsWith("SELECT migration_id")) {
      return {
        rows: [...this.database.applied].map(([migration_id, checksum]) => ({
          migration_id,
          checksum,
        })),
      };
    }
    if (normalized === "BEGIN") {
      this.database.events.push("begin");
      return { rows: [] };
    }
    if (normalized.startsWith("INSERT INTO mev_schema_migrations")) {
      this.#pending = [String(values[0]), String(values[1])];
      return { rows: [] };
    }
    if (normalized === "COMMIT") {
      if (this.#pending) this.database.applied.set(...this.#pending);
      this.#pending = undefined;
      this.database.events.push("commit");
      return { rows: [] };
    }
    if (normalized === "ROLLBACK") {
      this.#pending = undefined;
      this.database.events.push("rollback");
      return { rows: [] };
    }
    this.database.executed.push(text);
    if (text === this.database.failSql) throw new Error("migration failed");
    return { rows: [] };
  }

  release(): void {
    this.database.events.push("release");
  }
}

function pool(database: TestDatabase): MigrationPool {
  return { connect: async () => new TestClient(database) };
}

function migration(id: string, sql: string): Migration {
  return { id, sql, checksum: checksumMigration(sql) };
}

describe("checksummed migrations", () => {
  const migrations = [
    migration("0001_first", "SELECT 'first'"),
    migration("0002_second", "SELECT 'second'"),
  ];

  it("applies a fresh database once and is idempotent", async () => {
    const database = new TestDatabase();
    await runMigrations(pool(database), migrations);
    await runMigrations(pool(database), migrations);

    expect(database.executed).toEqual(["SELECT 'first'", "SELECT 'second'"]);
    expect([...database.applied.keys()]).toEqual(["0001_first", "0002_second"]);
    expect(database.events.filter((event) => event === "lock")).toHaveLength(2);
    expect(database.events.at(-1)).toBe("release");
  });

  it("adopts an existing database without replaying ledgered schema", async () => {
    const database = new TestDatabase();
    database.applied.set(migrations[0].id, migrations[0].checksum);

    await runMigrations(pool(database), migrations);

    expect(database.executed).toEqual(["SELECT 'second'"]);
    expect(database.applied.size).toBe(2);
  });

  it("serializes concurrent service startups", async () => {
    const database = new TestDatabase();

    await Promise.all([
      runMigrations(pool(database), migrations),
      runMigrations(pool(database), migrations),
      runMigrations(pool(database), migrations),
    ]);

    expect(database.executed).toEqual(["SELECT 'first'", "SELECT 'second'"]);
    expect(database.events.filter((event) => event === "lock")).toHaveLength(3);
  });

  it("rejects migration drift and always releases the advisory lock", async () => {
    const database = new TestDatabase();
    database.applied.set("0001_first", "0".repeat(64));

    await expect(runMigrations(pool(database), migrations)).rejects.toThrow("checksum mismatch");
    expect(database.events.slice(-2)).toEqual(["unlock", "release"]);
  });

  it("rolls back a failed migration and leaves it retryable", async () => {
    const database = new TestDatabase();
    database.failSql = "SELECT 'second'";

    await expect(runMigrations(pool(database), migrations)).rejects.toThrow("migration failed");
    expect(database.applied.has("0001_first")).toBe(true);
    expect(database.applied.has("0002_second")).toBe(false);
    expect(database.events).toContain("rollback");

    database.failSql = undefined;
    await runMigrations(pool(database), migrations);
    expect(database.applied.has("0002_second")).toBe(true);
  });
});
