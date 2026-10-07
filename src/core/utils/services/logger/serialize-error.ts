const CIRCULAR = "[Circular]";

/**
 * Deep-converts a value into a JSON-safe, stable representation.
 *
 * Error instances are turned into plain objects ({ name, message, ... }) so
 * their non-enumerable fields (message, cause, ...) survive serialization —
 * the default stringifier (safe-stable-stringify) would collapse them to {}.
 * Own enumerable properties (e.g. BaseError meta/type, axios code/status)
 * are preserved and recursed into.
 */
export default function serializeError(
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return CIRCULAR;
  }
  seen.add(value);

  if (value instanceof Error) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "stack") {
        continue;
      }
      out[key] = serializeError(item, seen);
    }
    out.name ??= value.name;
    out.message ??= value.message;
    // cause is non-enumerable on built-in errors; extract it explicitly
    const cause = (value as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      out.cause ??= serializeError(cause, seen);
    }
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeError(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "function") {
      continue;
    }
    out[key] = serializeError(item, seen);
  }
  return out;
}
