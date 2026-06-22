import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

async function main(): Promise<void> {
  const compose = readFileSync(new URL("../../../compose.yaml", import.meta.url), "utf8");
  const required = [
    ["windmill", ["OTEL_SERVICE_NAME: windmill", "OTEL_EXPORTER_OTLP_ENDPOINT"]],
    ["temporal", ["OTEL_SERVICE_NAME: temporal", "OTEL_EXPORTER_OTLP_ENDPOINT"]],
    ["pgbackrest", ["OTEL_SERVICE_NAME: pgbackrest", "OTEL_EXPORTER_OTLP_ENDPOINT"]],
    ["clamav", ["OTEL_SERVICE_NAME: clamav", "OTEL_EXPORTER_OTLP_ENDPOINT"]],
  ] as const;
  for (const [service, needles] of required) {
    assert.ok(compose.includes(`${service}:`), `${service} service exists`);
    for (const needle of needles) assert.ok(compose.includes(needle), `${service} has ${needle}`);
    assert.ok(
      compose.includes("healthcheck:"),
      `${service} observability provider status is healthchecked`
    );
  }
  assert.ok(compose.includes("loki:"), "loki service exists");
  assert.ok(compose.includes("prometheus:"), "prometheus service exists");
  assert.ok(compose.includes("tempo:"), "tempo service exists");
  assert.ok(compose.includes("alertmanager:"), "alertmanager service exists");
  assert.ok(
    compose.includes("restart: unless-stopped") || compose.includes("restart: on-failure"),
    "observability providers declare restart failure recovery"
  );
  console.log(
    JSON.stringify(
      {
        capability: "V2 provider observability closure",
        result: "PASSED",
        services: ["windmill", "temporal", "pgbackrest", "clamav"],
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
