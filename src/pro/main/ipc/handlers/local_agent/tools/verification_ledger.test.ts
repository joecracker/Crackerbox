import { describe, expect, it } from "vitest";
import {
  addVerificationEntry,
  createVerificationLedger,
  deriveVerificationReceipt,
} from "./verification_ledger";

describe("verification ledger", () => {
  it("does not create a receipt when code did not change", () => {
    expect(
      deriveVerificationReceipt({
        workspaceChanged: false,
        finalMutationCount: 0,
        ledger: createVerificationLedger(),
      }),
    ).toBeUndefined();
  });

  it("keeps a scoped pass scoped", () => {
    const ledger = createVerificationLedger();
    addVerificationEntry(ledger, {
      check: "type-check",
      outcome: "passed",
      scope: { kind: "paths", paths: ["src/button.tsx"] },
      summary: "No type errors found in src/button.tsx.",
      mutationCountAtStart: 1,
      mutationCountAtFinish: 1,
    });

    expect(
      deriveVerificationReceipt({
        workspaceChanged: true,
        finalMutationCount: 1,
        ledger,
      }),
    ).toEqual({
      status: "verification-passed",
      text: "Checks: Type check passed (src/button.tsx). tests/build/pre-commit not run.",
    });
  });

  it("marks a check stale after a later mutation", () => {
    const ledger = createVerificationLedger();
    addVerificationEntry(ledger, {
      check: "tests",
      outcome: "passed",
      scope: { kind: "paths", paths: ["e2e-tests/login.spec.ts"] },
      summary: "Tests passed.",
      mutationCountAtStart: 1,
      mutationCountAtFinish: 1,
    });

    expect(
      deriveVerificationReceipt({
        workspaceChanged: true,
        finalMutationCount: 2,
        ledger,
      }),
    ).toEqual({
      status: "changed-unverified",
      text: "Checks: Tests stale after later changes. type check/build/pre-commit not run.",
    });
  });

  it("treats unavailable checks as unverified, not failed", () => {
    const ledger = createVerificationLedger();
    addVerificationEntry(ledger, {
      check: "build",
      outcome: "unavailable",
      scope: { kind: "whole-project" },
      summary: "No build script is available.",
      mutationCountAtStart: 1,
      mutationCountAtFinish: 1,
    });

    expect(
      deriveVerificationReceipt({
        workspaceChanged: true,
        finalMutationCount: 1,
        ledger,
      })?.status,
    ).toBe("changed-unverified");
  });

  it("reports a fresh failed check as failed", () => {
    const ledger = createVerificationLedger();
    addVerificationEntry(ledger, {
      check: "pre-commit",
      outcome: "failed",
      scope: { kind: "whole-project" },
      summary: "The pre-commit hook failed.",
      mutationCountAtStart: 3,
      mutationCountAtFinish: 3,
    });

    expect(
      deriveVerificationReceipt({
        workspaceChanged: true,
        finalMutationCount: 3,
        ledger,
      })?.status,
    ).toBe("verification-failed");
  });
});
