import pg from "pg";

/**
 * Postgres-backed readiness probe adapter.
 *
 * Owns the readiness `SELECT 1` SQL so apps/platform-api/src/server contains
 * no raw SQL — keeping with ADR-ACT-0008's canonical separation: SQL belongs
 * exclusively to adapters, migrations, and seeds.
 *
 * Uses a short-lived pg.Client for each probe so a failed-but-recovering
 * database does not pollute a long-lived pool with broken connections.
 */
export class PostgresReadinessAdapter {
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async ping(): Promise<"ok" | "failed"> {
    const client = new pg.Client(this.connectionString);
    try {
      await client.connect();
      await client.query("SELECT 1");
      return "ok";
    } catch {
      return "failed";
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
