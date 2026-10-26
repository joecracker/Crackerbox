import type { z } from "zod";

// Each round fixes every value the schema rejected. A few rounds is plenty;
// the cap only stops a value that can never be fixed from looping forever.
const MAX_REPAIR_ROUNDS = 10;

/**
 * Parses a settings object, repairing values this version of Crackerbox does
 * not understand instead of rejecting the whole file. That happens when a
 * newer version saved a choice this one has never heard of (on 2026-10-25 a
 * newer voice engine value made an older install throw away every setting).
 *
 * A bad top-level value goes back to its default, or is dropped when it has
 * none. A bad value deeper down is dropped. Everything else is kept as is.
 * If the data still does not fit after that, this throws like `parse`.
 */
export function parseSettingsWithRepair<S extends z.ZodType>(
  schema: S,
  data: unknown,
  defaults: object,
  warn: (message: string) => void = () => {},
): z.output<S> {
  const first = schema.safeParse(data);
  if (first.success) return first.data;
  if (!isRecord(data)) return schema.parse(data);

  const current = structuredClone(data);
  let issues = first.error.issues;
  for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
    let repaired = false;
    for (const issue of issues) {
      const name = repairAt(current, issue.path, defaults);
      if (name) {
        warn(
          `Setting "${name}" could not be read by this version of Crackerbox, so it was reset to its default.`,
        );
        repaired = true;
      }
    }
    if (!repaired) break;
    const result = schema.safeParse(current);
    if (result.success) return result.data;
    issues = result.error.issues;
  }
  return schema.parse(current);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fixes the value at `path`; returns its name, or null if nothing changed. */
function repairAt(
  root: Record<PropertyKey, unknown>,
  path: readonly PropertyKey[],
  defaults: object,
): string | null {
  if (path.length === 0) return null;
  const name = path.map(String).join(".");

  if (path.length === 1) {
    const key = path[0];
    const defaultValues = defaults as Record<PropertyKey, unknown>;
    if (key in defaultValues) {
      const fallback = defaultValues[key];
      // Already the default and still rejected: nothing more to try here.
      if (key in root && isSameValue(root[key], fallback)) return null;
      root[key] = structuredClone(fallback);
      return name;
    }
    if (!(key in root)) return null;
    delete root[key];
    return name;
  }

  let parent: unknown = root;
  for (const key of path.slice(0, -1)) {
    if (!isRecord(parent) && !Array.isArray(parent)) return null;
    parent = (parent as Record<PropertyKey, unknown>)[key];
  }
  // Removing an item from a list would shift the others, so leave lists alone.
  if (!isRecord(parent)) return null;
  const key = path[path.length - 1];
  if (!(key in parent)) return null;
  delete parent[key];
  return name;
}

function isSameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
