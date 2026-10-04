// @vitest-environment node

import { PassThrough } from "node:stream";
import type * as http from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => {
  const scoped = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  return { default: { scope: () => scoped } };
});

import {
  buildDyadMediaUrlFromPhonePath,
  servePhoneMedia,
  setPhoneMediaHandler,
} from "./phone_bridge_media";

function fakeResponse() {
  const body = new PassThrough();
  const chunks: Buffer[] = [];
  body.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const res = Object.assign(body, {
    statusCode: 0,
    headers: {} as Record<string, string>,
    headersSent: false,
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode = status;
      res.headers = headers ?? {};
      res.headersSent = true;
      return res;
    },
  });
  const done = new Promise<void>((resolve) => body.on("end", resolve));
  return {
    res: res as unknown as http.ServerResponse,
    raw: res,
    done,
    text: () => Buffer.concat(chunks).toString("utf-8"),
  };
}

const getReq = { method: "GET" } as http.IncomingMessage;

describe("buildDyadMediaUrlFromPhonePath", () => {
  it("maps a media path to the dyad-media URL", () => {
    expect(
      buildDyadMediaUrlFromPhonePath(
        "/__phone_bridge/media/my-app/.dyad/screenshot/abc.png",
        "",
      ),
    ).toBe("dyad-media://media/my-app/.dyad/screenshot/abc.png");
  });

  it("keeps the query string (thumbnail sizes)", () => {
    expect(
      buildDyadMediaUrlFromPhonePath(
        "/__phone_bridge/media/my-app/.dyad/media/x.jpg",
        "?thumbnail=256",
      ),
    ).toBe("dyad-media://media/my-app/.dyad/media/x.jpg?thumbnail=256");
  });

  it("rejects other prefixes and empty paths", () => {
    expect(buildDyadMediaUrlFromPhonePath("/other/x.png", "")).toBeNull();
    expect(
      buildDyadMediaUrlFromPhonePath("/__phone_bridge/media/", ""),
    ).toBeNull();
  });

  it("rejects folder climbing, plain and encoded", () => {
    expect(
      buildDyadMediaUrlFromPhonePath("/__phone_bridge/media/a/../b.png", ""),
    ).toBeNull();
    expect(
      buildDyadMediaUrlFromPhonePath(
        "/__phone_bridge/media/a/%2e%2e/b.png",
        "",
      ),
    ).toBeNull();
    expect(
      buildDyadMediaUrlFromPhonePath("/__phone_bridge/media/a%5C..%5Cb", ""),
    ).toBeNull();
    expect(
      buildDyadMediaUrlFromPhonePath("/__phone_bridge/media/a%00b.png", ""),
    ).toBeNull();
    expect(
      buildDyadMediaUrlFromPhonePath("/__phone_bridge/media/%E0%A4%A", ""),
    ).toBeNull();
  });
});

describe("servePhoneMedia", () => {
  afterEach(() => setPhoneMediaHandler(null));

  it("answers 503 before the handler is ready", async () => {
    const out = fakeResponse();
    await servePhoneMedia(
      getReq,
      out.res,
      "/__phone_bridge/media/a/.dyad/media/x.png",
      "",
    );
    expect(out.raw.statusCode).toBe(503);
  });

  it("refuses methods other than GET and HEAD", async () => {
    setPhoneMediaHandler(() => new Response("x"));
    const out = fakeResponse();
    await servePhoneMedia(
      { method: "POST" } as http.IncomingMessage,
      out.res,
      "/__phone_bridge/media/a/.dyad/media/x.png",
      "",
    );
    expect(out.raw.statusCode).toBe(405);
  });

  it("does not call the handler for a climbing path", async () => {
    const handler = vi.fn(() => new Response("secret"));
    setPhoneMediaHandler(handler);
    const out = fakeResponse();
    await servePhoneMedia(
      getReq,
      out.res,
      "/__phone_bridge/media/a/../../secrets.txt",
      "",
    );
    expect(out.raw.statusCode).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("streams the handler answer with a locked-down header set", async () => {
    const handler = vi.fn(
      () =>
        new Response("PNGDATA", {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
    );
    setPhoneMediaHandler(handler);
    const out = fakeResponse();
    await servePhoneMedia(
      getReq,
      out.res,
      "/__phone_bridge/media/a/.dyad/screenshot/h.png",
      "",
    );
    await out.done;
    const requested = (handler.mock.calls[0] as unknown as [Request])[0];
    expect(requested.url).toBe("dyad-media://media/a/.dyad/screenshot/h.png");
    expect(out.raw.statusCode).toBe(200);
    expect(out.raw.headers["Content-Type"]).toBe("image/png");
    expect(out.raw.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(out.raw.headers["Content-Security-Policy"]).toContain("sandbox");
    expect(out.text()).toBe("PNGDATA");
  });

  it("passes the handler's error status through", async () => {
    setPhoneMediaHandler(() => new Response("Not Found", { status: 404 }));
    const out = fakeResponse();
    await servePhoneMedia(
      getReq,
      out.res,
      "/__phone_bridge/media/a/.dyad/media/missing.png",
      "",
    );
    await out.done;
    expect(out.raw.statusCode).toBe(404);
  });
});
