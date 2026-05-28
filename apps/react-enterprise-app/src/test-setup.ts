import "@testing-library/jest-dom";
import { configureAxe } from "vitest-axe";
import "vitest-axe/extend-expect";

configureAxe({
  rules: {
    // allow region landmark rule to be less strict during testing
    region: { enabled: false },
  },
});
