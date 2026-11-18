import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { getPhoneAccessInfo } from "@/main/phone_bridge_server";
import { resetPhoneAccessKey } from "@/main/phone_bridge_auth";

export function registerPhoneAccessHandlers() {
  createTypedHandler(systemContracts.getPhoneAccessInfo, async () => {
    return getPhoneAccessInfo();
  });
  createTypedHandler(systemContracts.resetPhoneAccessKey, async () => {
    resetPhoneAccessKey();
    return getPhoneAccessInfo();
  });
}
