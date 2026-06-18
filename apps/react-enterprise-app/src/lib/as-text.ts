/**
 * Safe value→text helpers for table/detail rendering (ADR-ACT-0290).
 *
 * Two admin views previously each carried their own `asText` that called
 * JSON.stringify directly — which throws on circular references, BigInt, a
 * throwing `toJSON`, or exotic proxies, blanking the whole table. This is the
 * single shared implementation; it never throws.
 *
 * NOTE: the backend has an equivalent `safeStringify` in @platform/platform-logging.
 * It is intentionally NOT imported here — that package pulls in pino (a Node
 * logger) and must never enter the browser bundle. The pure logic is kept in
 * sync between the two runtimes by their respective unit tests.
 */

/**
 * Stringify any value without ever throwing. Scalars render readably; JSON-
 * compatible objects serialise as JSON (BigInt coerced to its decimal string);
 * anything unserialisable returns a constant marker that never inspects property
 * values (so a fallback cannot leak a secret held inside the object).
 */
export function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
  try {
    const json = JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
    return json ?? "[unserializable]";
  } catch {
    return "[unserializable]";
  }
}

/**
 * Render a value as display text. Nullish → empty string (so a missing field
 * shows blank, not the literal "null"); strings pass through; everything else
 * goes through {@link safeStringify}.
 */
export function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return safeStringify(v);
}
