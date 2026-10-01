import { describe, expect, it } from "vitest";
import {
  EMPTY_RENDERER_RECOVERY_STATE,
  getRendererRecoveryDecision,
  RENDERER_EMERGENCY_THRESHOLD_MB,
  RENDERER_RECOVERY_THRESHOLD_MB,
} from "./renderer_memory_guard";

describe("renderer memory guard", () => {
  it("recovers a renderer before it reaches crash-sized memory use", () => {
    expect(
      getRendererRecoveryDecision(
        RENDERER_RECOVERY_THRESHOLD_MB,
        EMPTY_RENDERER_RECOVERY_STATE,
      ),
    ).toBe("recover");
  });

  it("leaves healthy renderers alone", () => {
    expect(
      getRendererRecoveryDecision(
        RENDERER_RECOVERY_THRESHOLD_MB - 1,
        EMPTY_RENDERER_RECOVERY_STATE,
      ),
    ).toBe("none");
  });

  it("does not repeatedly reload at the normal threshold", () => {
    expect(
      getRendererRecoveryDecision(RENDERER_RECOVERY_THRESHOLD_MB + 500, {
        recovered: true,
        emergencyRecovered: false,
      }),
    ).toBe("none");
  });

  it("allows one higher emergency recovery after the normal recovery", () => {
    expect(
      getRendererRecoveryDecision(RENDERER_EMERGENCY_THRESHOLD_MB, {
        recovered: true,
        emergencyRecovered: false,
      }),
    ).toBe("emergency");
    expect(
      getRendererRecoveryDecision(RENDERER_EMERGENCY_THRESHOLD_MB + 500, {
        recovered: true,
        emergencyRecovered: true,
      }),
    ).toBe("none");
  });
});
