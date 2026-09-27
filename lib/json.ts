/**
 * JSON serialization for the data shapes used by this skill.
 *
 * Output convention: pretty-printed with a 2-space indent, non-ASCII kept
 * literal, and a strict int/float distinction -- integer values serialize
 * without a decimal part (e.g. `150`), while float values always keep one
 * (e.g. `0.0`). Since JavaScript numbers do not carry int/float identity,
 * whole-number floats must be wrapped with `floatValue()`.
 */

export class FloatValue {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }
}

export function floatValue(value: number): FloatValue {
  return new FloatValue(value);
}

function serializeScalar(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value instanceof FloatValue) {
    const n = value.value;
    return Number.isInteger(n) ? `${n}.0` : String(n);
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  throw new Error(`Unsupported JSON value: ${String(value)}`);
}

function serialize(value: unknown, indent: number, level: number): string {
  const innerPad = " ".repeat(indent * (level + 1));
  const outerPad = " ".repeat(indent * level);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const items = value.map(
      (item) => innerPad + serialize(item, indent, level + 1),
    );
    return `[\n${items.join(",\n")}\n${outerPad}]`;
  }

  if (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof FloatValue)
  ) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return "{}";
    }
    const items = entries.map(
      ([key, item]) =>
        `${innerPad}${JSON.stringify(key)}: ${serialize(item, indent, level + 1)}`,
    );
    return `{\n${items.join(",\n")}\n${outerPad}}`;
  }

  return serializeScalar(value);
}

export function stringify(value: unknown, indent = 2): string {
  return serialize(value, indent, 0);
}
