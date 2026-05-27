function pkgRule(id, forbiddenPrefixes, forbiddenExact) {
  return {
    id,
    match(specifier) {
      if (forbiddenExact.includes(specifier)) return true;
      return forbiddenPrefixes.some((p) => specifier.startsWith(p));
    },
    message(pkg, specifier) {
      return `${pkg} must not import ${specifier}`;
    }
  };
}

export const UNIVERSAL_RULES = [
  {
    id: "no-deep-import",
    productionOnly: false,
    match(specifier) {
      if (!specifier.startsWith("@platform/")) return false;
      return specifier.slice("@platform/".length).includes("/");
    },
    message(pkg, specifier) {
      return `${pkg} must not use deep import: ${specifier}`;
    }
  },
  {
    id: "no-test-support-in-prod",
    productionOnly: true,
    match(specifier) {
      return specifier === "@platform/test-support";
    },
    message(pkg, specifier) {
      return `${pkg}: production files must not import @platform/test-support`;
    }
  }
];

export const PACKAGE_RULES = {
  "@platform/domain-core": [
    pkgRule("no-react-in-domain", [], ["react", "react-dom"]),
    pkgRule("no-graphql-in-domain", ["@apollo/", "@graphql-codegen/"], ["graphql"]),
    pkgRule("no-adapters-in-domain", ["@platform/adapters-"], ["@platform/react-enterprise-app", "@platform/feature-workflow"]),
    pkgRule("no-operations-in-domain", ["@platform/api-runtime", "@platform/graphql-api-runtime", "@platform/worker-runtime"], ["@platform/session-runtime", "@platform/security-auth", "@platform/audit-events", "@platform/observability", "@platform/queue-runtime", "@platform/storage-runtime", "@platform/config-runtime"])
  ],
  "@platform/ui-design-system": [
    pkgRule("no-domain-in-ui", ["@platform/adapters-", "@platform/contracts-"], ["@platform/domain-core", "@platform/profile-configuration", "@platform/access-control"])
  ],
  "@platform/profile-configuration": [
    pkgRule("no-adapters-in-profile", [], ["@platform/adapters-postgres", "@platform/adapters-clickhouse", "@platform/adapters-graphql", "react", "react-dom"]),
    pkgRule("no-operations-in-profile", ["@platform/api-runtime", "@platform/graphql-api-runtime", "@platform/worker-runtime", "@platform/adapters-keycloak", "@platform/adapters-redis", "@platform/adapters-sentry", "@platform/adapters-opentelemetry", "@platform/adapters-object-storage"], ["@platform/session-runtime", "@platform/security-auth", "@platform/observability", "@platform/queue-runtime", "@platform/storage-runtime", "@platform/config-runtime"])
  ],
  "@platform/access-control": [
    pkgRule("no-adapters-in-access-control", [], ["@platform/adapters-postgres", "@platform/adapters-clickhouse"]),
    pkgRule("no-react-in-access-control", [], ["react", "react-dom"]),
    pkgRule("no-operations-in-access-control", ["@platform/api-runtime", "@platform/graphql-api-runtime", "@platform/worker-runtime", "@platform/adapters-keycloak", "@platform/adapters-redis", "@platform/adapters-sentry", "@platform/adapters-opentelemetry", "@platform/adapters-object-storage"], ["@platform/session-runtime", "@platform/security-auth", "@platform/observability", "@platform/queue-runtime", "@platform/storage-runtime", "@platform/config-runtime"])
  ],
  "@platform/contracts-graphql": [
    pkgRule("no-adapters-in-contracts-graphql", [], ["@platform/adapters-graphql"])
  ],
  "@platform/contracts-ingestion": [
    pkgRule("no-adapters-in-contracts-ingestion", [], ["@platform/adapters-ingestion", "@platform/adapters-postgres", "@platform/adapters-clickhouse"])
  ],
  "@platform/contracts-analytics": [
    pkgRule("no-adapters-in-contracts-analytics", [], ["@platform/adapters-clickhouse"])
  ],
  "@platform/feature-workflow": [
    pkgRule("no-adapters-in-feature", [], ["@platform/adapters-postgres", "@platform/adapters-clickhouse"]),
    pkgRule("no-operations-adapters-in-feature", [], ["@platform/adapters-keycloak", "@platform/adapters-redis", "@platform/adapters-sentry", "@platform/adapters-opentelemetry", "@platform/adapters-object-storage"]),
    pkgRule("no-server-runtime-in-feature", [], ["@platform/api-runtime", "@platform/graphql-api-runtime", "@platform/worker-runtime", "@platform/session-runtime", "@platform/security-auth"])
  ],
  "@platform/security-auth": [
    pkgRule("no-platform-deps-in-security-auth", ["@platform/"], [])
  ],
  "@platform/observability": [
    pkgRule("no-platform-deps-in-observability", ["@platform/"], [])
  ],
  "@platform/queue-runtime": [
    pkgRule("no-platform-deps-in-queue-runtime", ["@platform/"], [])
  ],
  "@platform/storage-runtime": [
    pkgRule("no-platform-deps-in-storage-runtime", ["@platform/"], [])
  ],
  "@platform/audit-events": [
    pkgRule("no-platform-deps-in-audit-events", ["@platform/"], [])
  ],
  "@platform/config-runtime": [
    pkgRule("no-platform-deps-in-config-runtime", ["@platform/"], [])
  ]
};
