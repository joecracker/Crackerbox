import { appRunConformance } from "@/app_run/conformance.test_support";
import { appRunRemoteIntentContract } from "@/app_run/remote_intent_contract";

/**
 * Test-only registration index. Production definitions remain on the existing
 * RemoteMachineContract/protocol-v1 path.
 */
export const PILOT_CONFORMANCE_REGISTRATIONS = [
  {
    contract: appRunRemoteIntentContract,
    conformance: appRunConformance,
  },
] as const;
