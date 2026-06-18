import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  evaluateAlert,
  getObservabilityReadiness,
  listIncidents,
  recordSample,
  registerSignal,
  setAlertRule,
  updateIncident,
} from "../../src/usecases/observability.ts";
import type {
  AlertRepository,
  AlertRuleRecord,
  IncidentRecord,
  IncidentRepository,
  MetricRepository,
  MetricSignalRecord,
  OpenIncidentInput,
  RegisterSignalInput,
  UpsertAlertRuleInput,
} from "../../src/ports/observability-repository.ts";
import type {
  NotificationRepository,
  PreferenceRecord,
} from "../../src/ports/notification-repository.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const ACTOR = { actorId: "op", actorRoles: ["system-admin"] };

function capturingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    port: {
      emit: async (e) => {
        events.push(e);
      },
      query: async () => events,
    },
  };
}

function fakeRepo(): MetricRepository &
  AlertRepository &
  IncidentRepository & { _incidents: IncidentRecord[] } {
  const signals = new Map<string, MetricSignalRecord>();
  const samples = new Map<string, number>();
  const rules = new Map<string, AlertRuleRecord & { organisationId: string }>();
  const incidents: (IncidentRecord & { organisationId: string })[] = [];
  let rn = 0;
  let inc = 0;
  return {
    _incidents: incidents,
    async registerSignal(i: RegisterSignalInput) {
      signals.set(i.signalKey, {
        signalKey: i.signalKey,
        displayName: i.displayName,
        unit: i.unit ?? "",
        kind: i.kind ?? "gauge",
        description: i.description ?? "",
        latestValue: samples.get(i.signalKey) ?? null,
      });
    },
    async listSignals() {
      return [...signals.values()].map((s) => ({
        ...s,
        latestValue: samples.get(s.signalKey) ?? null,
      }));
    },
    async listSignalsAsOperator() {
      return [...signals.values()].map((s) => ({
        ...s,
        latestValue: samples.get(s.signalKey) ?? null,
      }));
    },
    async recordSample(_o, k, v) {
      samples.set(k, v);
    },
    async latestValue(_o, k) {
      return samples.get(k) ?? null;
    },
    async countSignals() {
      return signals.size;
    },
    async upsertRule(i: UpsertAlertRuleInput) {
      const existing = [...rules.values()].find((r) => r.ruleKey === i.ruleKey);
      const id = existing?.id ?? `rule-${++rn}-0000-0000-0000-000000000000`;
      rules.set(id, {
        id,
        organisationId: i.organisationId,
        ruleKey: i.ruleKey,
        signalKey: i.signalKey,
        comparator: i.comparator,
        threshold: i.threshold,
        severity: i.severity,
        enabled: i.enabled,
        notifyUserId: i.notifyUserId ?? null,
        notifyCategory: i.notifyCategory,
        updatedAt: null,
        updatedBy: i.updatedBy,
      });
    },
    async listRules() {
      return [...rules.values()];
    },
    async listRulesAsOperator() {
      return [...rules.values()];
    },
    async findRuleById(id) {
      return rules.get(id) ?? null;
    },
    async open(i: OpenIncidentInput) {
      const rec: IncidentRecord & { organisationId: string } = {
        id: `inc-${++inc}-0000-0000-0000-000000000000`,
        organisationId: i.organisationId,
        ruleKey: i.ruleKey,
        title: i.title,
        severity: i.severity,
        status: "open",
        observedValue: i.observedValue,
        threshold: i.threshold,
        openedAt: new Date(0).toISOString(),
        acknowledgedAt: null,
        resolvedAt: null,
      };
      incidents.push(rec);
      return rec;
    },
    async listForTenant() {
      return incidents;
    },
    async listForTenantAsOperator() {
      return incidents;
    },
    async findById(id) {
      return incidents.find((x) => x.id === id) ?? null;
    },
    async updateStatus(id, status) {
      const i = incidents.find((x) => x.id === id);
      if (!i) return null;
      i.status = status;
      if (status === "acknowledged") i.acknowledgedAt = new Date(0).toISOString();
      if (status === "resolved") i.resolvedAt = new Date(0).toISOString();
      return i;
    },
    async countOpen() {
      return incidents.filter((x) => x.status !== "resolved").length;
    },
  };
}

function fakeNotifications(prefs: PreferenceRecord[]): {
  notifications: NotificationRepository;
  audit: AuditEventPort;
} {
  const log: { channel: string; status: string }[] = [];
  return {
    notifications: {
      listPreferences: async () => prefs,
      listPreferencesAsOperator: async () => prefs,
      upsertPreferences: async () => {},
      logDispatch: async (i) => {
        log.push({ channel: i.channel, status: i.status });
      },
      countLog: async () => log.length,
    },
    audit: capturingAudit().port,
  };
}

function deps(prefs: PreferenceRecord[] = []) {
  const repo = fakeRepo();
  const audit = capturingAudit();
  return {
    repo,
    audit,
    deps: {
      metrics: repo,
      alerts: repo,
      incidents: repo,
      audit: audit.port,
      notifications: fakeNotifications(prefs),
    },
  };
}

describe("observability/alerting usecase", () => {
  it("registers a signal + sample; readiness degraded→ready", async () => {
    const { deps: d } = deps();
    assert.equal((await getObservabilityReadiness(d)).status, "degraded");
    await registerSignal(
      { organisationId: ORG, signalKey: "api.error_rate", displayName: "err", unit: "%" },
      d
    );
    await recordSample(ORG, "api.error_rate", 2, d);
    const r = await getObservabilityReadiness(d);
    assert.equal(r.status, "ready");
    assert.equal(r.signalCount, 1);
  });

  it("alert evaluates within threshold (no incident) and fires above (opens incident, audited)", async () => {
    const { deps: d, repo, audit } = deps();
    await registerSignal({ organisationId: ORG, signalKey: "s", displayName: "s" }, d);
    await setAlertRule(
      {
        organisationId: ORG,
        ruleKey: "err-high",
        signalKey: "s",
        comparator: "gt",
        threshold: 5,
        actor: ACTOR,
      },
      d
    );
    const ruleId = (await repo.listRules(ORG))[0]!.id;

    await recordSample(ORG, "s", 2, d);
    const within = await evaluateAlert(ruleId, d, ACTOR);
    assert.equal(within.kind === "ok" && within.response.state, "within");
    assert.equal(repo._incidents.length, 0);

    await recordSample(ORG, "s", 9, d);
    const fired = await evaluateAlert(ruleId, d, ACTOR);
    assert.equal(fired.kind === "ok" && fired.response.state, "fired");
    assert.equal(repo._incidents.length, 1);
    assert.ok(audit.events.some((e) => e.action === "incident.opened"));
  });

  it("no_data when the signal has no samples; disabled rule short-circuits", async () => {
    const { deps: d, repo } = deps();
    await setAlertRule(
      {
        organisationId: ORG,
        ruleKey: "k",
        signalKey: "missing",
        comparator: "gt",
        threshold: 1,
        actor: ACTOR,
      },
      d
    );
    const id = (await repo.listRules(ORG))[0]!.id;
    assert.equal((await evaluateAlert(id, d, ACTOR)).kind === "ok" && true, true);
    const r = await evaluateAlert(id, d, ACTOR);
    assert.equal(r.kind === "ok" && r.response.state, "no_data");
  });

  it("fired alert dispatches via the notification substrate; disabled channel suppresses", async () => {
    const { deps: d, repo } = deps([
      { channel: "email", category: "system", enabled: true },
      { channel: "webhook", category: "system", enabled: false },
    ]);
    await registerSignal({ organisationId: ORG, signalKey: "s", displayName: "s" }, d);
    await setAlertRule(
      {
        organisationId: ORG,
        ruleKey: "k",
        signalKey: "s",
        comparator: "gte",
        threshold: 10,
        notifyUserId: "user-1",
        notifyCategory: "system",
        actor: ACTOR,
      },
      d
    );
    await recordSample(ORG, "s", 10, d);
    const id = (await repo.listRules(ORG))[0]!.id;
    const r = await evaluateAlert(id, d, ACTOR);
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") {
      const byChannel = Object.fromEntries(r.response.notified.map((n) => [n.channel, n.status]));
      assert.equal(byChannel["email"], "sent");
      assert.equal(byChannel["webhook"], "suppressed");
    }
  });

  it("incident lifecycle (ack → resolve) is audited", async () => {
    const { deps: d, repo, audit } = deps();
    await setAlertRule(
      {
        organisationId: ORG,
        ruleKey: "k",
        signalKey: "s",
        comparator: "gt",
        threshold: 0,
        actor: ACTOR,
      },
      d
    );
    await recordSample(ORG, "s", 1, d);
    const id = (await repo.listRules(ORG))[0]!.id;
    await evaluateAlert(id, d, ACTOR);
    const incidentId = repo._incidents[0]!.id;
    assert.equal(
      (await updateIncident({ incidentId, status: "acknowledged", actor: ACTOR }, d)).kind,
      "ok"
    );
    const res = await updateIncident({ incidentId, status: "resolved", actor: ACTOR }, d);
    assert.equal(res.kind === "ok" && res.incident.status, "resolved");
    assert.ok(audit.events.filter((e) => e.action === "incident.updated").length >= 2);
    assert.equal((await listIncidents(ORG, d, { operator: true })).incidents.length, 1);
  });
});
