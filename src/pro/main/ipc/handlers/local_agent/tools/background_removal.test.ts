import { describe, expect, it } from "vitest";
import {
  BG_REMOVE_MAX_BYTES,
  removeBackgroundWithVenice,
} from "./background_removal";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3, 4]);

function fakeFetch(respond: () => Response) {
  const seen: { url: string; body: any; auth: string }[] = [];
  const fetchImpl = (async (url: string, init: any) => {
    seen.push({
      url,
      body: JSON.parse(init.body),
      auth: init.headers.Authorization,
    });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

describe("removeBackgroundWithVenice", () => {
  it("sends the picture as base64 and returns the PNG", async () => {
    const { fetchImpl, seen } = fakeFetch(
      () => new Response(new Uint8Array(PNG)),
    );
    const out = await removeBackgroundWithVenice({
      apiKey: "k",
      bytes: Buffer.from("hello"),
      fetchImpl,
    });
    expect(out.equals(PNG)).toBe(true);
    expect(seen[0].url).toMatch(/\/image\/background-remove$/);
    expect(seen[0].body.image).toBe(Buffer.from("hello").toString("base64"));
    expect(seen[0].auth).toBe("Bearer k");
  });

  it("explains an empty balance", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("no", { status: 402 }));
    await expect(
      removeBackgroundWithVenice({
        apiKey: "k",
        bytes: Buffer.from("x"),
        fetchImpl,
      }),
    ).rejects.toThrow(/balance is empty/);
  });

  it("rejects an answer that is not a picture", async () => {
    const { fetchImpl } = fakeFetch(() => new Response('{"oops":true}'));
    await expect(
      removeBackgroundWithVenice({
        apiKey: "k",
        bytes: Buffer.from("x"),
        fetchImpl,
      }),
    ).rejects.toThrow(/did not send back a picture/);
  });

  it("refuses pictures over 25 MB before calling Venice", async () => {
    const { fetchImpl, seen } = fakeFetch(() => new Response(""));
    await expect(
      removeBackgroundWithVenice({
        apiKey: "k",
        bytes: Buffer.alloc(BG_REMOVE_MAX_BYTES + 1),
        fetchImpl,
      }),
    ).rejects.toThrow(/over 25 MB/);
    expect(seen).toHaveLength(0);
  });
});
