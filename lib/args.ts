/**
 * Small argument parser for the skill scripts. Supports `--name value` and
 * `--name=value`, required options, defaults, `int` / `date` coercions, and
 * repeatable options (collected in the order they appear).
 *
 * Argument errors exit with code 2; script-level errors exit with code 1.
 */

export type OptionType = "string" | "int" | "date";

export interface OptionSpec {
  name: string;
  required?: boolean;
  default?: string;
  type?: OptionType;
  repeatable?: boolean;
}

export type Scalar = string | number | Date;

export type ParsedArgs = Record<string, Scalar | Scalar[]>;

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(2);
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    fail(`Invalid date '${value}', expected YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    fail(`Invalid date '${value}', expected YYYY-MM-DD`);
  }
  return parsed;
}

function coerce(spec: OptionSpec, value: string): Scalar {
  switch (spec.type) {
    case "int": {
      if (!/^-?\d+$/.test(value)) {
        fail(`argument --${spec.name}: invalid int value: '${value}'`);
      }
      return Number.parseInt(value, 10);
    }
    case "date":
      return parseDate(value);
    default:
      return value;
  }
}

export function parseArgs(argv: string[], specs: OptionSpec[]): ParsedArgs {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const raw = new Map<string, string[]>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      fail(`unrecognized argument: ${token}`);
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    let name: string;
    let value: string | undefined;
    if (eq >= 0) {
      name = body.slice(0, eq);
      value = body.slice(eq + 1);
    } else {
      name = body;
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        fail(`argument --${name}: expected one argument`);
      }
      i += 1;
    }
    const spec = byName.get(name);
    if (!spec) {
      fail(`unrecognized arguments: --${name}`);
    }
    if (spec.repeatable) {
      raw.set(name, [...(raw.get(name) ?? []), value]);
    } else {
      raw.set(name, [value]);
    }
  }

  const result: ParsedArgs = {};
  for (const spec of specs) {
    const values = raw.get(spec.name);
    if (values) {
      const coerced = values.map((value) => coerce(spec, value));
      result[spec.name] = spec.repeatable
        ? coerced
        : coerced[coerced.length - 1];
    } else if (spec.required) {
      fail(`the following arguments are required: --${spec.name}`);
    } else if (spec.default !== undefined) {
      const coerced = coerce(spec, spec.default);
      result[spec.name] = spec.repeatable ? [coerced] : coerced;
    }
  }
  return result;
}

/** Normalize a possibly-repeated option value into a string list. */
export function toStringList(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => String(item));
}

/**
 * Pair two equally-sized lists by index, preserving order:
 * `pairs[i] = [first[i], second[i]]`.
 *
 * Throws on a length mismatch so callers can report it as an argument error.
 */
export function pairByIndex(
  first: string[],
  second: string[],
  labels: [string, string] = ["first", "second"],
): Array<[string, string]> {
  if (first.length !== second.length) {
    throw new Error(
      `${labels[0]} count (${first.length}) does not match ` +
        `${labels[1]} count (${second.length})`,
    );
  }
  return first.map((value, index) => [value, second[index]]);
}
