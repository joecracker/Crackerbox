import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { getPhoneAccessInfo } from "@/main/phone_bridge_server";

export function registerPhoneAccessHandlers() {
  createTypedHandler(systemContracts.getPhoneAccessInfo, async () => {
    return getPhoneAccessInfo();
  });
}
