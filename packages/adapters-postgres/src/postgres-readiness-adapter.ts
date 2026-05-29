import pg from "pg";

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
