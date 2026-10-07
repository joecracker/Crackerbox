export type VerificationCheck = "type-check" | "tests" | "build" | "pre-commit";

export type VerificationOutcome =
  | "passed"
  | "failed"
  | "incomplete"
  | "unavailable";

export type VerificationScope =
  | { kind: "whole-project" }
  | { kind: "paths"; paths: string[] }
  | { kind: "filtered-tests"; paths: string[]; grep: string };

export interface VerificationEntry {
  check: VerificationCheck;
  outcome: VerificationOutcome;
  scope: VerificationScope;
  summary: string;
  mutationCountAtStart: number;
  mutationCountAtFinish: number;
}

export interface VerificationLedger {
  entries: VerificationEntry[];
}

export type VerificationStatus =
  | "no-code-changed"
  | "changed-unverified"
  | "verification-passed"
  | "verification-failed";

export interface VerificationReceipt {
  status: Exclude<VerificationStatus, "no-code-changed">;
  text: string;
}

const CHECK_ORDER: VerificationCheck[] = [
  "type-check",
  "tests",
  "build",
  "pre-commit",
];

const CHECK_LABELS: Record<VerificationCheck, string> = {
  "type-check": "Type check",
  tests: "Tests",
  build: "Build",
  "pre-commit": "Pre-commit",
};

export function createVerificationLedger(): VerificationLedger {
  return { entries: [] };
}

export function addVerificationEntry(
  ledger: VerificationLedger | undefined,
  entry: VerificationEntry,
): void {
  ledger?.entries.push(entry);
}

function describeScope(scope: VerificationScope): string {
  if (scope.kind === "whole-project") return "whole project";
  if (scope.kind === "filtered-tests") {
    return `${scope.paths.join(", ")} matching /${scope.grep}/`;
  }
  return scope.paths.join(", ");
}

function describeEntry(entry: VerificationEntry, isStale: boolean): string {
  const label = CHECK_LABELS[entry.check];
  if (isStale) return `${label} stale after later changes`;

  const scope = describeScope(entry.scope);
  const scoped = entry.scope.kind === "whole-project" ? "" : ` (${scope})`;
  switch (entry.outcome) {
    case "passed":
      return `${label} passed${scoped}`;
    case "failed":
      return `${label} failed${scoped}`;
    case "incomplete":
      return `${label} incomplete${scoped}`;
    case "unavailable":
      return `${label} unavailable${scoped}`;
  }
}

export function deriveVerificationReceipt({
  workspaceChanged,
  finalMutationCount,
  ledger,
}: {
  workspaceChanged: boolean;
  finalMutationCount: number;
  ledger: VerificationLedger;
}): VerificationReceipt | undefined {
  if (!workspaceChanged) return undefined;

  const latestByCheck = new Map<VerificationCheck, VerificationEntry>();
  for (const entry of ledger.entries) latestByCheck.set(entry.check, entry);

  const entries = CHECK_ORDER.flatMap((check) => {
    const entry = latestByCheck.get(check);
    return entry ? [entry] : [];
  });
  const freshEntries = entries.filter(
    (entry) =>
      entry.mutationCountAtStart === entry.mutationCountAtFinish &&
      entry.mutationCountAtFinish === finalMutationCount,
  );
  const status: VerificationReceipt["status"] = freshEntries.some(
    (entry) => entry.outcome === "failed",
  )
    ? "verification-failed"
    : freshEntries.some((entry) => entry.outcome === "passed")
      ? "verification-passed"
      : "changed-unverified";

  const reported = entries.map((entry) =>
    describeEntry(
      entry,
      entry.mutationCountAtStart !== entry.mutationCountAtFinish ||
        entry.mutationCountAtFinish !== finalMutationCount,
    ),
  );
  const missing = CHECK_ORDER.filter((check) => !latestByCheck.has(check));
  if (missing.length > 0) {
    reported.push(
      `${missing.map((check) => CHECK_LABELS[check].toLowerCase()).join("/")} not run`,
    );
  }

  return {
    status,
    text: `Checks: ${reported.length > 0 ? reported.join(". ") : "none run"}.`,
  };
}
