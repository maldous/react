import { describe, it, expect } from "vitest";
import { safeStringify, asText } from "../lib/as-text";

describe("safeStringify (frontend, ADR-ACT-0290)", () => {
  it("passes strings through and renders scalars readably", () => {
    expect(safeStringify("hello")).toBe("hello");
    expect(safeStringify(null)).toBe("null");
    expect(safeStringify(undefined)).toBe("undefined");
    expect(safeStringify(42)).toBe("42");
    expect(safeStringify(true)).toBe("true");
    expect(safeStringify(Symbol("s"))).toBe("Symbol(s)");
    expect(safeStringify(() => {})).toMatch(/^\[Function: /);
  });

  it("serialises ordinary objects as JSON and coerces nested BigInt", () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
    expect(safeStringify({ big: 10n })).toBe('{"big":"10"}');
    expect(safeStringify(10n)).toBe("10");
  });

  it("returns a safe marker for circular refs and throwing toJSON (never throws)", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(safeStringify(circular)).toBe("[unserializable]");
    expect(
      safeStringify({
        toJSON() {
          throw new Error("boom");
        },
      })
    ).toBe("[unserializable]");
  });

  it("does not leak secret values through the fallback", () => {
    const holder: Record<string, unknown> = { apiKey: "super-secret" };
    holder["self"] = holder;
    const out = safeStringify(holder);
    expect(out).toBe("[unserializable]");
    expect(out).not.toContain("super-secret");
  });
});

describe("asText display wrapper", () => {
  it("renders nullish as empty string and strings unchanged", () => {
    expect(asText(null)).toBe("");
    expect(asText(undefined)).toBe("");
    expect(asText("plain")).toBe("plain");
  });

  it("renders scalars and objects via safeStringify", () => {
    expect(asText(7)).toBe("7");
    expect(asText(false)).toBe("false");
    expect(asText({ k: "v" })).toBe('{"k":"v"}');
  });

  it("never throws on a circular object", () => {
    const c: Record<string, unknown> = {};
    c["self"] = c;
    expect(() => asText(c)).not.toThrow();
    expect(asText(c)).toBe("[unserializable]");
  });
});
