import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createI18n,
  serverT,
  flattenLocaleMessages,
  type I18nMessages,
  type I18nLocaleResource,
} from "../src/index.ts";

// Flat fixture (used by existing tests ? backward compat)
const EN_GB: I18nMessages = {
  "app.shell.nav.organisationProfile": "Organisation profile",
  "feature.organisation.profile.title": "Organisation profile",
  "feature.organisation.profile.form.displayName.label": "Display name",
  "feature.organisation.profile.form.displayName.validation.required": "Display name is required",
  "feature.organisation.profile.form.displayName.validation.tooShort":
    "Display name must be at least {min} characters",
  "api.error.unauthenticated": "You need to sign in to continue",
  "api.error.forbidden": "You do not have permission to perform this action",
};

// Nested fixture ? mirrors actual en-GB.json structure
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

describe("createI18n ? flat messages (backward compat)", () => {
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
    const frMessages: I18nMessages = { "api.error.unauthenticated": "Vous devez vous connecter" };
    const i18n = createI18n({ locale: "fr-FR", messages: frMessages, fallback: EN_GB });
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
});

describe("createI18n ? nested JSON messages (en-GB.json shape)", () => {
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
    const i18n = createI18n({ locale: "fr-FR", messages: frNested, fallback: EN_GB_NESTED });
    assert.equal(
      i18n.t("api.error.forbidden"),
      "You do not have permission to perform this action"
    );
    assert.equal(i18n.t("api.error.unauthenticated"), "Vous devez vous connecter");
  });
});

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
});
