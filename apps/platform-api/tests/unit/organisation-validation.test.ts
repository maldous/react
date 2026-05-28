import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normaliseOrganisationDisplayName } from "../../src/usecases/organisation.ts";
import { ValidationError } from "@platform/platform-errors";

describe("normaliseOrganisationDisplayName", () => {
  it("trims leading and trailing whitespace", () => {
    assert.equal(normaliseOrganisationDisplayName("  Acme Corp  "), "Acme Corp");
  });

  it("preserves internal spaces", () => {
    assert.equal(normaliseOrganisationDisplayName("Acme  Corp"), "Acme  Corp");
  });

  it("rejects empty string", () => {
    assert.throws(
      () => normaliseOrganisationDisplayName(""),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("rejects whitespace-only string", () => {
    assert.throws(
      () => normaliseOrganisationDisplayName("   "),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("rejects name shorter than 2 chars after trim", () => {
    assert.throws(
      () => normaliseOrganisationDisplayName("A"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("accepts exactly 2-char name", () => {
    assert.equal(normaliseOrganisationDisplayName("AB"), "AB");
  });

  it("rejects name longer than 120 chars", () => {
    assert.throws(
      () => normaliseOrganisationDisplayName("A".repeat(121)),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("accepts exactly 120-char name", () => {
    const name = "A".repeat(120);
    assert.equal(normaliseOrganisationDisplayName(name), name);
  });

  it("rejects string containing a control character (\\x00)", () => {
    assert.throws(
      () => normaliseOrganisationDisplayName("Acme\x00Corp"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("rejects string containing a tab character", () => {
    assert.throws(
      () => normaliseOrganisationDisplayName("Acme\tCorp"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it("rejects string containing a newline", () => {
    assert.throws(
      () => normaliseOrganisationDisplayName("Acme\nCorp"),
      (err: unknown) => err instanceof ValidationError
    );
  });
});
