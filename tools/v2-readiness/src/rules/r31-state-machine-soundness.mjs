import { finding } from "../vocab.mjs";
import { buildReports, stateMachineSoundness } from "../formal-assurance.mjs";

export default function r31StateMachineSoundness(ctx) {
  const generated = buildReports(ctx);
  const machines = ctx.formalModel?.["state-machines.json"]?.machines;
  const report = Array.isArray(machines)
    ? stateMachineSoundness(machines)
    : generated.reports.stateMachineSoundness;
  return report.violations.map((violation) =>
    finding(
      "R31-state-machine-soundness",
      violation.machine,
      `${violation.type}${violation.state ? `: ${violation.state}` : ""}`
    )
  );
}
