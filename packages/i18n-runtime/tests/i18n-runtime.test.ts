import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createI18n, serverT, type I18nLocale } from "../src/index.ts";

const EN_GB: I18nLocale = {
  "app.shell.nav.organisationProfile": "Organisation profile",
  "feature.organisation.profile.title": "Organisation profile",
  "feature.organisation.profile.form.displayName.label": "Display name",
  "feature.organisation.profile.form.displayName.validation.required": "Display name is required",
  "feature.organisation.profile.form.displayName.validation.tooShort":
    "Display name must be at least {min} characters",
  "api.error.unauthenticated": "You need to sign in to continue",
  "api.error.forbidden": "You do not have permission to perform this action",
};

describe("createI18n", () => {
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
    const frMessages: I18nLocale = { "api.error.unauthenticated": "Vous devez vous connecter" };
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
});

describe("serverT", () => {
  it("resolves a key from the provided locale", () => {
    const result = serverT(EN_GB, "api.error.unauthenticated");
    assert.equal(result, "You need to sign in to continue");
  });

  it("returns the key when missing", () => {
    const result = serverT(EN_GB, "api.error.missing");
    assert.equal(result, "api.error.missing");
  });

  it("interpolates parameters in serverT", () => {
    const messages: I18nLocale = { "test.msg": "Hello {name}" };
    const result = serverT(messages, "test.msg", { name: "World" });
    assert.equal(result, "Hello World");
  });
});
