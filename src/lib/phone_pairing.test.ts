import { describe, it, expect } from "vitest";
import {
  buildPairingUrl,
  normalizeRemoteAddress,
  sortLanUrls,
} from "./phone_pairing";

describe("normalizeRemoteAddress", () => {
  it("accepts a bare host name and makes it https", () => {
    expect(normalizeRemoteAddress("remote.example.com")).toEqual({
      ok: true,
      origin: "https://remote.example.com",
    });
  });

  it("cleans a pasted full address down to https://host", () => {
    expect(
      normalizeRemoteAddress("  https://Remote.Example.com/some/page?x=1#top "),
    ).toEqual({ ok: true, origin: "https://remote.example.com" });
  });

  it("keeps a port if one was typed", () => {
    expect(normalizeRemoteAddress("https://remote.example.com:8443/")).toEqual({
      ok: true,
      origin: "https://remote.example.com:8443",
    });
  });

  it("refuses empty, plain http, and one-word names", () => {
    expect(normalizeRemoteAddress("   ").ok).toBe(false);
    expect(normalizeRemoteAddress("http://remote.example.com").ok).toBe(false);
    expect(normalizeRemoteAddress("localhost").ok).toBe(false);
    expect(normalizeRemoteAddress("not a url at all").ok).toBe(false);
  });
});

describe("buildPairingUrl", () => {
  it("adds the install marker and nothing else", () => {
    expect(buildPairingUrl("https://remote.example.com")).toBe(
      "https://remote.example.com/?cbpair=1",
    );
    expect(buildPairingUrl("http://192.168.1.16:4319")).toBe(
      "http://192.168.1.16:4319/?cbpair=1",
    );
  });

  it("drops any path, query or hash from the base", () => {
    expect(buildPairingUrl("https://remote.example.com/a/b?c=d#e")).toBe(
      "https://remote.example.com/?cbpair=1",
    );
  });
});

describe("sortLanUrls", () => {
  it("puts normal home Wi-Fi addresses first", () => {
    expect(
      sortLanUrls([
        "http://10.147.18.91:4319",
        "http://172.20.0.1:4319",
        "http://192.168.1.16:4319",
      ]),
    ).toEqual([
      "http://192.168.1.16:4319",
      "http://10.147.18.91:4319",
      "http://172.20.0.1:4319",
    ]);
  });

  it("does not change the list it was given", () => {
    const input = ["http://10.0.0.5:4319", "http://192.168.0.5:4319"];
    sortLanUrls(input);
    expect(input[0]).toBe("http://10.0.0.5:4319");
  });
});
