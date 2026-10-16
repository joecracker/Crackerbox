// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  PREVIEW_PUBLIC_PORT,
  allowFramingBy,
  cookiesForPreviewApp,
  hostName,
  hostPort,
  isPreviewHost,
  planPreviewHostRequest,
  readPreviewCookie,
  selectCookieHeader,
} from "./phone_bridge_preview_host";

const MIN = 42100;
const MAX = 52149;

describe("preview port detection", () => {
  it("knows a request that came in on the preview port", () => {
    expect(PREVIEW_PUBLIC_PORT).toBe(8443);
    expect(isPreviewHost("remote.crackerbox.app:8443")).toBe(true);
    expect(isPreviewHost("remote.crackerbox.app")).toBe(false);
    expect(isPreviewHost("192.168.1.16:4319")).toBe(false);
    expect(isPreviewHost(undefined)).toBe(false);
    expect(hostPort("x.app:8443")).toBe(8443);
    expect(hostName("remote.crackerbox.app:8443")).toBe(
      "remote.crackerbox.app",
    );
    expect(hostName("bad host!")).toBeNull();
  });
});

describe("planning a preview request", () => {
  it("remembers the named preview and goes to the same address without the marker", () => {
    expect(planPreviewHostRequest("/?cbp=42137", undefined, MIN, MAX)).toEqual({
      kind: "select",
      port: 42137,
      location: "/",
    });
    expect(
      planPreviewHostRequest("/page?x=1&cbp=42137", undefined, MIN, MAX),
    ).toEqual({ kind: "select", port: 42137, location: "/page?x=1" });
  });

  it("refuses a marker outside the preview ports", () => {
    expect(planPreviewHostRequest("/?cbp=22", undefined, MIN, MAX)).toEqual({
      kind: "none",
    });
    expect(planPreviewHostRequest("/?cbp=abc", undefined, MIN, MAX)).toEqual({
      kind: "none",
    });
  });

  it("uses the remembered preview for every other request", () => {
    expect(
      planPreviewHostRequest(
        "/src/main.tsx?t=1",
        "CF_Authorization=abc; cb_preview=42137",
        MIN,
        MAX,
      ),
    ).toEqual({ kind: "proxy", port: 42137, path: "/src/main.tsx?t=1" });
  });

  it("does nothing when no preview was chosen or the remembered one is out of range", () => {
    expect(planPreviewHostRequest("/", undefined, MIN, MAX)).toEqual({
      kind: "none",
    });
    expect(planPreviewHostRequest("/", "cb_preview=80", MIN, MAX)).toEqual({
      kind: "none",
    });
    expect(readPreviewCookie("cb_preview=42137", MIN, MAX)).toBe(42137);
  });

  it("sets a private cookie when remembering", () => {
    const cookie = selectCookieHeader(42137);
    expect(cookie).toContain("cb_preview=42137");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
  });
});

describe("what the preview app is shown", () => {
  it("keeps Crackerbox's own sign-in cookies away from the preview app", () => {
    expect(
      cookiesForPreviewApp(
        "a=1; CF_Authorization=secret; cb_preview=42137; b=2",
      ),
    ).toBe("a=1; b=2");
    expect(cookiesForPreviewApp("CF_Authorization=secret")).toBeUndefined();
    expect(cookiesForPreviewApp(undefined)).toBeUndefined();
  });

  it("lets Crackerbox's own address frame the preview, and nothing more", () => {
    const out = allowFramingBy(
      {
        "content-type": "text/html",
        "content-security-policy":
          "frame-ancestors 'self' file: http://localhost:*",
      },
      "https://remote.crackerbox.app",
    );
    expect(out["content-security-policy"]).toBe(
      "frame-ancestors https://remote.crackerbox.app 'self' file: http://localhost:*",
    );
    expect(out["content-type"]).toBe("text/html");
  });

  it("handles several policy headers", () => {
    const out = allowFramingBy(
      {
        "content-security-policy": [
          "default-src 'self'",
          "frame-ancestors 'self'",
        ],
      },
      "https://r.app",
    );
    expect(out["content-security-policy"]).toEqual([
      "default-src 'self'",
      "frame-ancestors https://r.app 'self'",
    ]);
  });
});
