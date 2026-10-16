// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  PHONE_ICON_192_PATH,
  PHONE_ICON_512_PATH,
  PHONE_INSTALL_HEAD_TAGS,
  PHONE_MANIFEST_PATH,
  PHONE_SERVICE_WORKER_PATH,
  servePhoneInstallAsset,
} from "./phone_bridge_install";

function fakeResponse() {
  const out = {
    status: 0,
    headers: {} as Record<string, string>,
    body: undefined as string | Buffer | undefined,
  };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      out.status = status;
      out.headers = headers;
    },
    end(body: string | Buffer) {
      out.body = body;
    },
  };
  return { out, res: res as never };
}

describe("phone install files", () => {
  it("serves an install file Chrome accepts", () => {
    const { out, res } = fakeResponse();
    expect(servePhoneInstallAsset(PHONE_MANIFEST_PATH, res)).toBe(true);
    expect(out.status).toBe(200);
    expect(out.headers["Content-Type"]).toContain("application/manifest+json");
    const manifest = JSON.parse(String(out.body));
    expect(manifest.name).toBe("Crackerbox");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("serves a helper script with a fetch handler that leaves requests alone", () => {
    const { out, res } = fakeResponse();
    expect(servePhoneInstallAsset(PHONE_SERVICE_WORKER_PATH, res)).toBe(true);
    expect(out.headers["Service-Worker-Allowed"]).toBe("/");
    const script = String(out.body);
    expect(script).toContain('addEventListener("fetch"');
    expect(script).not.toContain("respondWith");
  });

  it("serves both icons as real pictures of the right size", () => {
    for (const [path, size] of [
      [PHONE_ICON_192_PATH, 192],
      [PHONE_ICON_512_PATH, 512],
    ] as const) {
      const { out, res } = fakeResponse();
      expect(servePhoneInstallAsset(path, res)).toBe(true);
      const png = out.body as Buffer;
      expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
  });

  it("ignores every other address", () => {
    const { out, res } = fakeResponse();
    expect(servePhoneInstallAsset("/", res)).toBe(false);
    expect(servePhoneInstallAsset("/__phone_bridge/ws", res)).toBe(false);
    expect(out.status).toBe(0);
  });

  it("adds the install links to the page head", () => {
    expect(PHONE_INSTALL_HEAD_TAGS).toContain(
      '<link rel="manifest" href="' +
        PHONE_MANIFEST_PATH +
        '" crossorigin="use-credentials">',
    );
    expect(PHONE_INSTALL_HEAD_TAGS).toContain("serviceWorker");
  });
});
