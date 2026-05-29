import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryProfileConfigPort, DEFAULT_PREFERENCES } from "../src/index.ts";

describe("createInMemoryProfileConfigPort", () => {
  it("returns defaults for new user", async () => {
    const port = createInMemoryProfileConfigPort();
    const prefs = await port.get("user-1");
    assert.strictEqual(prefs.language, DEFAULT_PREFERENCES.language);
    assert.strictEqual(prefs.theme, DEFAULT_PREFERENCES.theme);
  });

  it("update persists preferences", async () => {
    const port = createInMemoryProfileConfigPort();
    await port.update("user-1", { theme: "dark" });
    const prefs = await port.get("user-1");
    assert.strictEqual(prefs.theme, "dark");
  });

  it("update merges partial — other fields unchanged", async () => {
    const port = createInMemoryProfileConfigPort();
    await port.update("user-1", { language: "fr-FR" });
    const prefs = await port.get("user-1");
    assert.strictEqual(prefs.language, "fr-FR");
    assert.strictEqual(prefs.theme, DEFAULT_PREFERENCES.theme);
  });

  it("reset returns defaults", async () => {
    const port = createInMemoryProfileConfigPort();
    await port.update("user-1", { theme: "dark", marketingEmails: true });
    await port.reset("user-1");
    const prefs = await port.get("user-1");
    assert.strictEqual(prefs.theme, DEFAULT_PREFERENCES.theme);
    assert.strictEqual(prefs.marketingEmails, DEFAULT_PREFERENCES.marketingEmails);
  });

  it("different users have isolated preferences", async () => {
    const port = createInMemoryProfileConfigPort();
    await port.update("user-1", { theme: "dark" });
    const prefs2 = await port.get("user-2");
    assert.strictEqual(prefs2.theme, DEFAULT_PREFERENCES.theme);
  });
});
