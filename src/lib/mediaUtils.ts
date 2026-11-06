/** Pictures with no section sit under this filter chip. */
export const UNSORTED_SECTION = "__unsorted__";

interface Searchable {
  fileName: string;
  section?: string;
  prompt?: string;
}

/** A picture matches a search by its file name, its section, or its prompt. */
export function fileMatchesQuery(file: Searchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    file.fileName.toLowerCase().includes(q) ||
    (file.section ?? "").toLowerCase().includes(q) ||
    (file.prompt ?? "").toLowerCase().includes(q)
  );
}

export function filterMediaAppsByQuery<
  T extends { appName: string; files: Searchable[] },
>(apps: T[], query: string): T[] {
  const trimmed = query.trim();
  if (!trimmed) return apps;
  const q = trimmed.toLowerCase();
  return apps.filter(
    (app) =>
      app.appName.toLowerCase().includes(q) ||
      app.files.some((f) => fileMatchesQuery(f, q)),
  );
}

/** Sections in use, A to Z, with how many pictures each holds. */
export function getSectionCounts(
  files: { section?: string }[],
): { section: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (!file.section) continue;
    counts.set(file.section, (counts.get(file.section) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([section, count]) => ({ section, count }))
    .sort((a, b) =>
      a.section.localeCompare(b.section, undefined, { sensitivity: "base" }),
    );
}

/** "" = all pictures, UNSORTED_SECTION = pictures with no section. */
export function fileMatchesSection(
  file: { section?: string },
  section: string,
): boolean {
  if (!section) return true;
  if (section === UNSORTED_SECTION) return !file.section;
  return file.section === section;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
