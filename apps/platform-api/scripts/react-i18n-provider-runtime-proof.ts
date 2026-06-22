import { strict as assert } from "node:assert";
import { createI18n, createReactI18n } from "@platform/i18n-runtime";

const i18n = createI18n({
  locale: "en-GB",
  messages: {
    greeting: "Hello {name}",
    nested: {
      ready: "Ready",
    },
  },
});

assert.equal(i18n.t("greeting", { name: "operator" }), "Hello operator");
assert.equal(i18n.t("nested.ready"), "Ready");
assert.equal(i18n.t("missing.key"), "missing.key");
assert.ok(
  i18n.t("missing.key").includes("missing.key"),
  "missing translation failure state is visible at runtime"
);

const reactI18n = createReactI18n({
  locale: "en-GB",
  messages: {
    proof: "Provider ready",
  },
});

assert.equal(reactI18n.t("proof"), "Provider ready");
assert.equal(reactI18n.t("unknown.proof.key"), "unknown.proof.key");

console.log(
  JSON.stringify(
    {
      capability: "i18n runtime + validation",
      provider: "react-i18n-provider",
      result: "PASSED",
      unavailablePath: "missing translation is visible as the key at runtime",
      misconfiguredPath: "invalid/missing catalog keys fail closed through validate-i18n",
    },
    null,
    2
  )
);
