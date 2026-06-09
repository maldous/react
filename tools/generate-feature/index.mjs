#!/usr/bin/env node
// Feature scaffolder (ADR-ACT-0203). Zero-dependency Node generator that emits a
// canonical, COMPILING feature skeleton conforming to the UI feature pattern
// (docs/patterns/ui-feature-template.md): a dumb page using design-system
// primitives + token classes, feature-owned hooks, an MSW-backed test, a route
// under the _authenticated layout with a permission gate, and i18n placeholders.
//
// Data hooks are stubbed (no GraphQL yet) so the feature builds and tests run
// immediately; a TODO points to the generated-document client pattern to wire in
// real operations. This deliberately emits NO inline GraphQL strings and no
// second <main>, so generated code passes the architecture validators.
//
//   npm run generate:feature -- --name=billing --type=form-edit
//   npm run generate:feature -- --name=audit-log --type=table-search --permission=platform.logs.read
//
// Types: form-edit | read-only-detail | table-search | admin-settings
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_SRC = path.join(REPO_ROOT, "apps", "react-enterprise-app", "src");
const EN_GB = path.join(REPO_ROOT, "packages", "i18n-runtime", "locales", "en-GB.json");

const TYPES = new Set(["form-edit", "read-only-detail", "table-search", "admin-settings"]);

function parseArgs(argv) {
  const opts = { name: null, type: null, permission: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") opts.name = argv[++i];
    else if (a === "--type") opts.type = argv[++i];
    else if (a === "--permission") opts.permission = argv[++i];
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--name=")) opts.name = a.slice(7);
    else if (a.startsWith("--type=")) opts.type = a.slice(7);
    else if (a.startsWith("--permission=")) opts.permission = a.slice(13);
    else throw new Error("Unknown argument: " + a);
  }
  return opts;
}

const toKebab = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
const toPascal = (s) =>
  toKebab(s)
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
const toCamel = (s) => {
  const p = toPascal(s);
  return p[0].toLowerCase() + p.slice(1);
};
const toTitle = (s) =>
  toKebab(s)
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

function names(raw) {
  return { kebab: toKebab(raw), pascal: toPascal(raw), camel: toCamel(raw), title: toTitle(raw) };
}

// ---- generated-file templates (returned as strings) ------------------------

function queriesFile(n) {
  return `import { useQuery } from "@tanstack/react-query";

// Feature-owned read hook. STUB: returns placeholder data so the feature compiles
// and tests run before operations exist. To wire real data, author
// packages/contracts-graphql/src/operations/${n.kebab}.graphql, run \`npm run codegen\`,
// then replace the queryFn body with:
//   const data = await graphqlRequest(${n.pascal}ListDocument); return data.${n.camel}s;
// (import graphqlRequest from "@platform/graphql-browser-client" and the generated
// document from "@platform/contracts-graphql"). Never inline GraphQL strings.

export interface ${n.pascal} {
  id: string;
  name: string;
}

export const ${n.camel}QueryKey = ["${n.kebab}"] as const;

export function use${n.pascal}List() {
  return useQuery<${n.pascal}[]>({
    queryKey: ${n.camel}QueryKey,
    queryFn: async () => {
      // TODO(${n.kebab}): replace stub with graphqlRequest(${n.pascal}ListDocument).
      return [];
    },
    staleTime: 30_000,
    retry: false,
  });
}
`;
}

function mutationsFile(n) {
  return `import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ${n.camel}QueryKey, type ${n.pascal} } from "./${n.kebab}.queries";
import type { ${n.pascal}FormValues } from "./${n.kebab}.schema";

// Feature-owned mutation hook with invalidate-on-success. STUB: replace the
// mutationFn with graphqlRequest(Update${n.pascal}Document, vars) once operations
// are generated. For optimistic UI add onMutate/onError rollback here.

export function useSave${n.pascal}() {
  const queryClient = useQueryClient();
  return useMutation<${n.pascal}, Error, ${n.pascal}FormValues>({
    mutationFn: async (input) => {
      // TODO(${n.kebab}): replace stub with graphqlRequest(Update${n.pascal}Document, input).
      return { id: "stub", name: input.name };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ${n.camel}QueryKey });
    },
  });
}
`;
}

function schemaFile(n) {
  return `import { z } from "zod";

// Feature form schema. Keep bounds in lock-step with the contract/domain rules.
export const ${n.pascal}FormSchema = z.object({
  name: z.string().min(2, "feature.${n.camel}.form.name.tooShort").max(120),
});

export type ${n.pascal}FormValues = z.infer<typeof ${n.pascal}FormSchema>;
`;
}

function formPage(n) {
  return `import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Card,
  CardBody,
  FormField,
  LiveRegion,
  LoadingState,
  ErrorState,
  SectionHeader,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { useSession } from "../../hooks/use-session";
import { ${n.pascal}FormSchema, type ${n.pascal}FormValues } from "./${n.kebab}.schema";
import { use${n.pascal}List } from "./${n.kebab}.queries";
import { useSave${n.pascal} } from "./${n.kebab}.mutations";

/** ${n.title} — generated from the form-edit template (ADR-ACT-0203). Dumb page:
 * design-system primitives + feature hooks only; the AppShell layout owns <main>. */
export function ${n.pascal}Page() {
  const { hasPermission } = useSession();
  const t = useTranslation();
  const { data, isLoading, isError } = use${n.pascal}List();
  const save = useSave${n.pascal}();
  const canEdit = hasPermission("${n.camel}.update");

  const { control, handleSubmit } = useForm<${n.pascal}FormValues>({
    resolver: zodResolver(${n.pascal}FormSchema),
    values: data && data[0] ? { name: data[0].name } : { name: "" },
  });

  if (isLoading) return <LoadingState message={t("ui.loading.default")} />;
  if (isError)
    return (
      <ErrorState title={t("feature.${n.camel}.error.title")} description={t("ui.error.tryAgain")} />
    );

  const onSubmit = (values: ${n.pascal}FormValues) => save.mutate(values);

  return (
    <section className="max-w-xl" data-testid="${n.kebab}">
      <SectionHeader heading={t("feature.${n.camel}.title")} level={1} className="mb-6" />
      <Card>
        <CardBody className="space-y-4">
          {canEdit ? (
            <form onSubmit={handleSubmit(onSubmit)} data-testid="${n.kebab}-form" noValidate>
              <Controller
                name="name"
                control={control}
                render={({ field, fieldState }) => (
                  <FormField
                    label={t("feature.${n.camel}.form.name.label")}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    isInvalid={!!fieldState.error}
                    errorMessage={fieldState.error ? t(fieldState.error.message ?? "") : undefined}
                    inputProps={{ "data-testid": "${n.kebab}-name-input" }}
                  />
                )}
              />
              <div className="mt-4">
                <Button type="submit" isDisabled={save.isPending} data-testid="${n.kebab}-save">
                  {save.isPending ? t("ui.action.saving") : t("ui.action.save")}
                </Button>
              </div>
              <LiveRegion tone="polite" className="mt-2 text-success">
                {save.isSuccess && t("ui.success.saved")}
              </LiveRegion>
              <LiveRegion tone="assertive" className="text-danger">
                {save.isError && t("ui.error.saveFailed")}
              </LiveRegion>
            </form>
          ) : (
            <p className="text-sm text-fg-muted" data-testid="${n.kebab}-read-only">
              {t("ui.accessDenied.readOnly")}
            </p>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
`;
}

function readOnlyPage(n) {
  return `import {
  LoadingState,
  ErrorState,
  EmptyState,
  Card,
  CardBody,
  SectionHeader,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { use${n.pascal}List } from "./${n.kebab}.queries";

/** ${n.title} — generated from the read-only-detail template (ADR-ACT-0203). */
export function ${n.pascal}Page() {
  const t = useTranslation();
  const { data, isLoading, isError } = use${n.pascal}List();

  if (isLoading) return <LoadingState message={t("ui.loading.default")} />;
  if (isError)
    return (
      <ErrorState title={t("feature.${n.camel}.error.title")} description={t("ui.error.tryAgain")} />
    );
  if (!data || data.length === 0)
    return (
      <EmptyState
        title={t("feature.${n.camel}.empty.title")}
        description={t("feature.${n.camel}.empty.description")}
      />
    );

  const item = data[0]!;
  return (
    <section className="max-w-xl" data-testid="${n.kebab}">
      <SectionHeader heading={t("feature.${n.camel}.title")} level={1} className="mb-6" />
      <Card>
        <CardBody>
          <dl className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
            <dt className="text-fg-muted">{t("feature.${n.camel}.field.name")}</dt>
            <dd className="font-medium text-fg" data-testid="${n.kebab}-name">
              {item.name}
            </dd>
          </dl>
        </CardBody>
      </Card>
    </section>
  );
}
`;
}

function tablePage(n) {
  return `import { useState } from "react";
import {
  DataTable,
  FormField,
  LoadingState,
  ErrorState,
  EmptyState,
  SectionHeader,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { use${n.pascal}List, type ${n.pascal} } from "./${n.kebab}.queries";

/** ${n.title} — generated from the table-search template (ADR-ACT-0203). */
export function ${n.pascal}Page() {
  const t = useTranslation();
  const { data, isLoading, isError } = use${n.pascal}List();
  const [query, setQuery] = useState("");

  if (isLoading) return <LoadingState message={t("ui.loading.default")} />;
  if (isError)
    return (
      <ErrorState title={t("feature.${n.camel}.error.title")} description={t("ui.error.tryAgain")} />
    );

  const rows: ${n.pascal}[] = (data ?? []).filter((r) =>
    r.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <section className="max-w-3xl" data-testid="${n.kebab}">
      <SectionHeader heading={t("feature.${n.camel}.title")} level={1} className="mb-6" />
      <div className="mb-4 max-w-sm">
        <FormField
          label={t("feature.${n.camel}.search.label")}
          value={query}
          onChange={setQuery}
          inputProps={{ "data-testid": "${n.kebab}-search", type: "search" }}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title={t("feature.${n.camel}.empty.title")}
          description={t("feature.${n.camel}.empty.description")}
        />
      ) : (
        <DataTable
          data={rows}
          columns={[
            { accessorKey: "name", header: t("feature.${n.camel}.field.name") },
            { accessorKey: "id", header: "ID" },
          ]}
        />
      )}
    </section>
  );
}
`;
}

function testFile(n, type) {
  const persona = type === "form-edit" || type === "admin-settings" ? "tenantAdmin" : "viewer";
  return `import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { server, sessionHandler } from "../../../msw";
import { ${n.pascal}Page } from "../${n.pascal}Page";

// Generated MSW-backed test. As you wire real operations, add resolvers via
// createGraphqlHandler({ ${n.pascal}List: () => ({ data: { ${n.camel}s: [...] } }) }).
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<${n.pascal}Page />, { wrapper: Wrapper });
}

describe("${n.pascal}Page", () => {
  it("renders for an authorised persona", async () => {
    server.use(sessionHandler("${persona}"));
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByTestId("${n.kebab}")).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});
`;
}

function routeFile(n, permission) {
  return `import { createRoute } from "@tanstack/react-router";
import { Route as AuthenticatedRoute } from "./_authenticated";
import { RequirePermission } from "../components/RequirePermission";
import { ${n.pascal}Page } from "../features/${n.kebab}/${n.pascal}Page";

export const Route = createRoute({
  getParentRoute: () => AuthenticatedRoute,
  path: "/${n.kebab}",
  component: ${n.pascal}RouteComponent,
});

function ${n.pascal}RouteComponent() {
  return (
    <RequirePermission permission="${permission}">
      <${n.pascal}Page />
    </RequirePermission>
  );
}
`;
}

function i18nKeys(n, type) {
  const base = {
    title: n.title,
    error: { title: "Could not load " + n.title.toLowerCase() },
    empty: { title: "No " + n.title.toLowerCase(), description: "Nothing to show yet." },
    field: { name: "Name" },
  };
  if (type === "form-edit" || type === "admin-settings") {
    base.form = { name: { label: "Name", tooShort: "Name must be at least 2 characters" } };
  }
  if (type === "table-search") {
    base.search = { label: "Search" };
  }
  return base;
}

function plan(n, type, permission) {
  const featureDir = path.join(APP_SRC, "features", n.kebab);
  const files = [];
  files.push([path.join(featureDir, n.kebab + ".queries.ts"), queriesFile(n)]);
  if (type === "form-edit" || type === "admin-settings") {
    files.push([path.join(featureDir, n.kebab + ".schema.ts"), schemaFile(n)]);
    files.push([path.join(featureDir, n.kebab + ".mutations.ts"), mutationsFile(n)]);
  }
  const pageContent =
    type === "read-only-detail"
      ? readOnlyPage(n)
      : type === "table-search"
        ? tablePage(n)
        : formPage(n);
  files.push([path.join(featureDir, n.pascal + "Page.tsx"), pageContent]);
  files.push([path.join(featureDir, "__tests__", n.pascal + "Page.test.tsx"), testFile(n, type)]);
  files.push([path.join(APP_SRC, "routes", n.kebab + ".tsx"), routeFile(n, permission)]);
  return files;
}

function mergeI18n(n, type, dryRun) {
  const json = JSON.parse(fs.readFileSync(EN_GB, "utf8"));
  json.feature = json.feature ?? {};
  if (json.feature[n.camel]) {
    console.log("  i18n: feature." + n.camel + ".* already present — leaving as-is");
    return;
  }
  json.feature[n.camel] = i18nKeys(n, type);
  if (!dryRun) fs.writeFileSync(EN_GB, JSON.stringify(json, null, 2) + "\n");
  console.log("  i18n: added feature." + n.camel + ".* to en-GB.json");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.name) throw new Error("--name is required");
  if (!opts.type || !TYPES.has(opts.type))
    throw new Error("--type must be one of: " + [...TYPES].join(", "));
  const n = names(opts.name);
  const permission = opts.permission ?? n.camel + ".read";

  console.log(
    'Scaffolding feature "' + n.kebab + '" (type=' + opts.type + ", permission=" + permission + ")"
  );
  const files = plan(n, opts.type, permission);

  for (const [filePath, content] of files) {
    const rel = path.relative(REPO_ROOT, filePath);
    if (fs.existsSync(filePath)) {
      console.log("  skip (exists): " + rel);
      continue;
    }
    if (opts.dryRun) {
      console.log("  would write: " + rel);
      continue;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    console.log("  write: " + rel);
  }
  mergeI18n(n, opts.type, opts.dryRun);

  console.log("\nNext steps:");
  console.log(
    "  1. Register the route in apps/react-enterprise-app/src/routeTree.gen.ts under the _authenticated layout."
  );
  console.log(
    "  2. Author packages/contracts-graphql/src/operations/" +
      n.kebab +
      ".graphql and run: npm run codegen"
  );
  console.log("  3. Replace the stub hooks with graphqlRequest(<generated document>).");
  console.log("  4. Run: npm run tsc:check && npm run test:frontend:run");
}

try {
  main();
} catch (err) {
  console.error("generate:feature failed: " + err.message);
  process.exit(1);
}
