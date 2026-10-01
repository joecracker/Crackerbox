export const RENDERER_RECOVERY_THRESHOLD_MB = 2048;
export const RENDERER_EMERGENCY_THRESHOLD_MB = 4096;
export const RENDERER_RECOVERY_RESET_MB = 1024;

export interface RendererRecoveryState {
  recovered: boolean;
  emergencyRecovered: boolean;
}

export const EMPTY_RENDERER_RECOVERY_STATE: RendererRecoveryState = {
  recovered: false,
  emergencyRecovered: false,
};

export type RendererRecoveryDecision = "none" | "recover" | "emergency";

export function getRendererRecoveryDecision(
  workingSetMB: number,
  state: RendererRecoveryState,
): RendererRecoveryDecision {
  if (
    workingSetMB >= RENDERER_EMERGENCY_THRESHOLD_MB &&
    !state.emergencyRecovered
  ) {
    return "emergency";
  }
  if (workingSetMB >= RENDERER_RECOVERY_THRESHOLD_MB && !state.recovered) {
    return "recover";
  }
  return "none";
}
