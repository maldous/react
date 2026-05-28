import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, it, expect } from "vitest";

function Greeting({ name }: { name: string }) {
  return <h1>Hello, {name}!</h1>;
}

describe("App test harness", () => {
  it("renders a greeting", () => {
    render(<Greeting name="World" />);
    expect(screen.getByRole("heading", { name: /hello, world/i })).toBeInTheDocument();
  });

  it("greeting has no accessibility violations", async () => {
    const { container } = render(<Greeting name="World" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
