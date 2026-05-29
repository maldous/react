import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsEvent } from "@platform/contracts-analytics";

export const packageName = "@platform/adapters-clickhouse";

export interface ClickHouseConfig {
  host?: string;
  username?: string;
  password?: string;
  database: string;
  table: string;
}

export class ClickHouseAnalyticsAdapter {
  private readonly client: ClickHouseClient;
  private readonly table: string;

  constructor(config: ClickHouseConfig, client?: ClickHouseClient) {
    this.table = config.table;
    this.client =
      client ??
      createClient({
        url: config.host ?? "http://localhost:8124",
        username: config.username ?? "default",
        password: config.password ?? "",
        database: config.database,
      });
  }

  async insert(event: AnalyticsEvent): Promise<void> {
    await this.client.insert({
      table: this.table,
      values: [event],
      format: "JSONEachRow",
    });
  }

  async bulkInsert(events: AnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.client.insert({
      table: this.table,
      values: events,
      format: "JSONEachRow",
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export function createClickHouseAnalyticsAdapter(
  config: ClickHouseConfig
): ClickHouseAnalyticsAdapter {
  return new ClickHouseAnalyticsAdapter(config);
}
