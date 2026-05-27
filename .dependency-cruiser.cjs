/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies are not allowed in this codebase.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-product-imports-architecture",
      severity: "error",
      comment: "Product code (apps/, packages/) must not import architecture tooling.",
      from: { path: "^(apps|packages)/" },
      to: { path: "^tools/architecture/" },
    },
    {
      name: "no-import-from-reports",
      severity: "warn",
      comment: "No runtime code should import from generated reports/.",
      from: {},
      to: { path: "^reports/" },
    },
    {
      name: "no-import-from-docs",
      severity: "warn",
      comment: "No runtime code should import from docs/.",
      from: {},
      to: { path: "^docs/" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: ["(^|/)node_modules/", "^reports/", "tests/fixtures"],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
