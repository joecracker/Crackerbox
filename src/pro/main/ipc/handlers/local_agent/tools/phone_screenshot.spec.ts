import { describe, expect, it } from "vitest";
import { parseReadyDevices } from "./phone_screenshot";

describe("parseReadyDevices", () => {
  it("keeps only devices that are connected and ready", () => {
    const output = [
      "List of devices attached",
      "R5CT12345\tdevice usb:1-2 product:x model:Pixel",
      "emulator-5554\tdevice",
      "ZX1\toffline",
      "AB2\tunauthorized",
      "",
    ].join("\r\n");
    expect(parseReadyDevices(output)).toEqual(["R5CT12345", "emulator-5554"]);
  });

  it("returns nothing when no device is attached", () => {
    expect(parseReadyDevices("List of devices attached\r\n\r\n")).toEqual([]);
  });
});
