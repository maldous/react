import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, it, expect } from "vitest";
import { Checkbox, Switch, RadioGroup } from "../src";

/**
 * Accessible-name regression guard (ADR-ACT-0290, S1874 accepted debt).
 *
 * Checkbox/Radio/Switch deliberately use react-aria-components' SINGLE-component
 * API, where the label `children` render inside the control and become its
 * accessible name. A previous remediation (commit 35a42fc) split them into a
 * Field+Button pattern to clear deprecation warnings (S1874); that split removed
 * the accessible name and was reverted (commit 7cf8763). The deprecations are
 * therefore ACCEPTED as tracked debt, NOT fixed.
 *
 * These tests fail loudly if any future migration strips the accessible name —
 * `getByRole(..., { name })` throws when the control has no name, and axe flags
 * a control with no label. That makes the accessibility decision enforceable,
 * not just documented.
 */
describe("accessible form controls keep their accessible name (ADR-ACT-0290)", () => {
  it("Checkbox exposes its label as the accessible name", async () => {
    const { container } = render(<Checkbox>Email notifications</Checkbox>);
    const checkbox = screen.getByRole("checkbox", { name: "Email notifications" });
    expect(checkbox).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Switch exposes its label as the accessible name", async () => {
    const { container } = render(<Switch>Dark mode</Switch>);
    const sw = screen.getByRole("switch", { name: "Dark mode" });
    expect(sw).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("RadioGroup exposes each option's label as its accessible name", async () => {
    const { container } = render(
      <RadioGroup
        aria-label="Plan"
        items={[
          { value: "free", label: "Free plan" },
          { value: "pro", label: "Pro plan" },
        ]}
      />
    );
    expect(screen.getByRole("radio", { name: "Free plan" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Pro plan" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
