import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createI18n,
  serverT,
  flattenLocaleMessages,
  type I18nMessages,
  type I18nLocaleResource,
} from "../src/index.ts";

// ── Fixtures ────────────────────────────────────────────────────────────────

const EN_GB: I18nMessages = {
  "app.shell.nav.organisationProfile": "Organisation profile",
  "feature.organisation.profile.title": "Organisation profile",
  "feature.organisation.profile.form.displayName.label": "Display name",
  "feature.organisation.profile.form.displayName.validation.required": "Display name is required",
  "feature.organisation.profile.form.displayName.validation.tooShort":
    "Display name must be at least {min} characters",
  "api.error.unauthenticated": "You need to sign in to continue",
  "api.error.forbidden": "You do not have permission to perform this action",
  // ICU plural
  "items.count": "{count, plural, one {# item} other {# items}}",
  "items.countExact": "{count, plural, =0 {No items} one {One item} other {# items}}",
  // ICU select
  "auth.greeting": "{gender, select, male {Welcome, sir} female {Welcome, madam} other {Welcome}}",
  // Nested interpolation within ICU blocks
  "billing.alert":
    "{count, plural, one {You have {count} overdue invoice} other {You have {count} overdue invoices}}",
};

const EN_GB_NESTED: I18nLocaleResource = {
  app: { shell: { nav: { organisationProfile: "Organisation profile" } } },
  feature: {
    organisation: {
      profile: {
        title: "Organisation profile",
        form: {
          displayName: {
            label: "Display name",
            validation: {
              required: "Display name is required",
              tooShort: "Display name must be at least {min} characters",
            },
          },
        },
      },
    },
  },
  api: {
    error: {
      unauthenticated: "You need to sign in to continue",
      forbidden: "You do not have permission to perform this action",
    },
  },
};

// ── flattenLocaleMessages ───────────────────────────────────────────────────

describe("flattenLocaleMessages", () => {
  it("flattens nested JSON to dot-separated keys", () => {
    const flat = flattenLocaleMessages(EN_GB_NESTED);
    assert.equal(flat["app.shell.nav.organisationProfile"], "Organisation profile");
    assert.equal(flat["feature.organisation.profile.title"], "Organisation profile");
    assert.equal(flat["api.error.unauthenticated"], "You need to sign in to continue");
  });

  it("returns flat maps unchanged", () => {
    const flat = flattenLocaleMessages(EN_GB);
    assert.equal(flat["api.error.forbidden"], EN_GB["api.error.forbidden"]);
  });
});

// ── createI18n – flat messages (backward compat) ────────────────────────────

describe("createI18n – flat messages (backward compat)", () => {
  it("returns a t() function that resolves en-GB keys", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("app.shell.nav.organisationProfile"), "Organisation profile");
  });

  it("t() interpolates named parameters safely", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    const result = i18n.t("feature.organisation.profile.form.displayName.validation.tooShort", {
      min: "2",
    });
    assert.equal(result, "Display name must be at least 2 characters");
  });

  it("t() returns the key when a key is missing", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("this.key.does.not.exist"), "this.key.does.not.exist");
  });

  it("t() does not execute HTML in interpolated values (XSS safety)", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    const result = i18n.t("feature.organisation.profile.form.displayName.validation.tooShort", {
      min: "<script>alert(1)</script>",
    });
    assert.ok(!result.includes("<script>"), "XSS payload must not appear in output");
    assert.ok(result.includes("&lt;script&gt;"), "HTML must be escaped");
  });

  it("falls back to en-GB when a key is missing from a non-default locale", () => {
    const frMessages: I18nMessages = {
      "api.error.unauthenticated": "Vous devez vous connecter",
    };
    const i18n = createI18n({
      locale: "fr-FR",
      messages: frMessages,
      fallback: EN_GB,
    });
    assert.equal(
      i18n.t("api.error.forbidden"),
      "You do not have permission to perform this action"
    );
    assert.equal(i18n.t("api.error.unauthenticated"), "Vous devez vous connecter");
  });

  it("does not leak raw secret-like values into escaped interpolations", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    const secret = "token_abc123";
    const result = i18n.t("feature.organisation.profile.form.displayName.validation.tooShort", {
      min: secret,
    });
    assert.ok(result.includes(secret), "Interpolation should preserve the provided value");
    assert.ok(!result.includes("<"), "Interpolated output should not introduce markup");
  });

  it("exposes locale on the instance", () => {
    const i18n = createI18n({ locale: "fr-FR", messages: {} });
    assert.equal(i18n.locale, "fr-FR");
  });
});

// ── createI18n – nested JSON messages ───────────────────────────────────────

describe("createI18n – nested JSON messages (en-GB.json shape)", () => {
  it("resolves dot-separated keys from nested JSON resource", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB_NESTED });
    assert.equal(i18n.t("feature.organisation.profile.title"), "Organisation profile");
    assert.equal(i18n.t("api.error.unauthenticated"), "You need to sign in to continue");
  });

  it("interpolates parameters from nested resource", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB_NESTED });
    const result = i18n.t("feature.organisation.profile.form.displayName.validation.tooShort", {
      min: "2",
    });
    assert.equal(result, "Display name must be at least 2 characters");
  });

  it("falls back to nested fallback when key missing from nested primary", () => {
    const frNested: I18nLocaleResource = {
      api: { error: { unauthenticated: "Vous devez vous connecter" } },
    };
    const i18n = createI18n({
      locale: "fr-FR",
      messages: frNested,
      fallback: EN_GB_NESTED,
    });
    assert.equal(
      i18n.t("api.error.forbidden"),
      "You do not have permission to perform this action"
    );
    assert.equal(i18n.t("api.error.unauthenticated"), "Vous devez vous connecter");
  });
});

// ── ICU plural ──────────────────────────────────────────────────────────────

describe("createI18n – ICU plural", () => {
  it("selects 'one' for count=1 in English", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("items.count", { count: 1 }), "1 item");
  });

  it("selects 'other' for count=5 in English", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("items.count", { count: 5 }), "5 items");
  });

  it("selects '=0' exact match for zero", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("items.countExact", { count: 0 }), "No items");
  });

  it("selects 'one' for count=1 with exact match template", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("items.countExact", { count: 1 }), "One item");
  });

  it("selects 'other' for count=42", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("items.countExact", { count: 42 }), "42 items");
  });

  it("handles nested interpolation within plural blocks", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("billing.alert", { count: 3 }), "You have 3 overdue invoices");
  });

  it("falls back to 'other' when category is not defined", () => {
    const msgs: I18nMessages = {
      "test.plural": "{n, plural, other {# things}}",
    };
    const i18n = createI18n({ locale: "en-GB", messages: msgs });
    assert.equal(i18n.t("test.plural", { n: 1 }), "1 things");
  });

  it("returns raw value when even 'other' is missing", () => {
    const msgs: I18nMessages = {
      "test.broken": "{n, plural, one {single}}",
    };
    const i18n = createI18n({ locale: "en-GB", messages: msgs });
    assert.equal(i18n.t("test.broken", { n: 5 }), "5");
  });

  it("handles missing plural param gracefully", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.ok(typeof i18n.t("items.count") === "string");
  });
});

// ── ICU select ──────────────────────────────────────────────────────────────

describe("createI18n – ICU select", () => {
  it("selects 'male' branch", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("auth.greeting", { gender: "male" }), "Welcome, sir");
  });

  it("selects 'female' branch", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("auth.greeting", { gender: "female" }), "Welcome, madam");
  });

  it("selects 'other' for unknown value", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("auth.greeting", { gender: "other" }), "Welcome");
  });

  it("selects 'other' when no param provided", () => {
    const i18n = createI18n({ locale: "en-GB", messages: EN_GB });
    assert.equal(i18n.t("auth.greeting"), "Welcome");
  });
});

// ── serverT ─────────────────────────────────────────────────────────────────

describe("serverT", () => {
  it("resolves a key from the provided locale (flat)", () => {
    const result = serverT(EN_GB, "api.error.unauthenticated");
    assert.equal(result, "You need to sign in to continue");
  });

  it("resolves a key from nested locale resource", () => {
    const result = serverT(EN_GB_NESTED, "api.error.unauthenticated");
    assert.equal(result, "You need to sign in to continue");
  });

  it("returns the key when missing", () => {
    const result = serverT(EN_GB, "api.error.missing");
    assert.equal(result, "api.error.missing");
  });

  it("interpolates parameters in serverT", () => {
    const messages: I18nMessages = { "test.msg": "Hello {name}" };
    const result = serverT(messages, "test.msg", { name: "World" });
    assert.equal(result, "Hello World");
  });

  it("supports ICU plural in serverT", () => {
    const result = serverT(EN_GB, "items.count", { count: 3 });
    assert.equal(result, "3 items");
  });

  it("supports ICU select in serverT", () => {
    const result = serverT(EN_GB, "auth.greeting", { gender: "male" });
    assert.equal(result, "Welcome, sir");
  });
});

// ── Plural rules by locale ──────────────────────────────────────────────────

describe("plural rules by locale", () => {
  it("Russian: one for 1", () => {
    const msgs: I18nMessages = {
      test: "{n, plural, one {один} few {несколько} many {много} other {другое}}",
    };
    const i18n = createI18n({ locale: "ru-RU", messages: msgs });
    assert.equal(i18n.t("test", { n: 1 }), "один");
  });

  it("Russian: few for 2", () => {
    const msgs: I18nMessages = {
      test: "{n, plural, one {один} few {несколько} many {много} other {другое}}",
    };
    const i18n = createI18n({ locale: "ru-RU", messages: msgs });
    assert.equal(i18n.t("test", { n: 2 }), "несколько");
  });

  it("Russian: many for 5", () => {
    const msgs: I18nMessages = {
      test: "{n, plural, one {один} few {несколько} many {много} other {другое}}",
    };
    const i18n = createI18n({ locale: "ru-RU", messages: msgs });
    assert.equal(i18n.t("test", { n: 5 }), "много");
  });

  it("Irish: two for 2", () => {
    const msgs: I18nMessages = {
      test: "{n, plural, one {ceann} two {dhá} few {cúpla} many {go leor} other {eile}}",
    };
    const i18n = createI18n({ locale: "ga-IE", messages: msgs });
    assert.equal(i18n.t("test", { n: 2 }), "dhá");
  });
});
