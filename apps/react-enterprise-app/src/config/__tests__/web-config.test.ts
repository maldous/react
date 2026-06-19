import { describe, it, expect } from "vitest";
import {
  loadWebPublicConfig,
  assertNoSecretFields,
  WebConfigError,
  WEB_PUBLIC_CONFIG_SCHEMA,
  type WebConfigFieldDef,
} from "../web-config";

describe("WebPublicConfig", () => {
  it("loads public config from an injected source and applies defaults", () => {
    const cfg = loadWebPublicConfig({ DEV: true, VITE_APP_VERSION: "1.2.3" });
    expect(cfg.dev).toBe(true);
    expect(cfg.appVersion).toBe("1.2.3");
    expect(cfg.faroCollectorUrl).toBe(""); // default
  });

  it("returns an immutable (frozen) projection", () => {
    const cfg = loadWebPublicConfig({});
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(() => {
      (cfg as { dev: boolean }).dev = true;
    }).toThrow();
  });

  it("rejects a secret/server-only field reaching the browser bundle", () => {
    const tainted: Record<string, WebConfigFieldDef> = {
      ...WEB_PUBLIC_CONFIG_SCHEMA,
      // a server-only secret accidentally added to the web schema
      apiSecret: { key: "VITE_API_SECRET", type: "string", public: false as unknown as true },
    };
    expect(() => assertNoSecretFields(tainted)).toThrow(WebConfigError);
  });

  it("every field in the real web schema is public (no secrets in the bundle)", () => {
    expect(() => assertNoSecretFields(WEB_PUBLIC_CONFIG_SCHEMA)).not.toThrow();
  });
});
