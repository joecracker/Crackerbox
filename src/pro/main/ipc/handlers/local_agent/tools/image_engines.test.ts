import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS_PER_HOUR,
  fitPrompt,
  generateImages,
  reserveAttempt,
  resetAttemptLog,
  resolveChain,
  resolveI2iChain,
  sniffExtension,
  statsLookBlank,
  type PixelSampler,
} from "./image_engines";
import { resetImageModelCache } from "./venice_image";
import { findSirayApiKey, findVeniceApiKey } from "./venice_api";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
const goodSampler: PixelSampler = async () => ({ mean: 90, spread: 40 });
const noSleep = async () => {};

const MODELS = {
  data: [
    {
      id: "chroma",
      model_spec: { constraints: { promptCharacterLimit: 1500 } },
    },
    { id: "wai-Illustrious", model_spec: {} },
  ],
};

interface Calls {
  veniceBodies: any[];
  veniceEditBodies: any[];
  sirayBodies: any[];
}

function fakeFetch(opts: {
  veniceStatus?: number;
  veniceImage?: string;
  sirayImage?: Buffer;
  veniceEditStatus?: number;
  sirayFailModels?: string[];
  /** Per-model poll answer that is a failure status. */
  sirayPollFail?: Record<string, { status: string; reason: string }>;
}): { fetchImpl: typeof fetch; calls: Calls } {
  const calls: Calls = {
    veniceBodies: [],
    veniceEditBodies: [],
    sirayBodies: [],
  };
  const taskModel = new Map<string, string>();
  const fetchImpl = (async (url: string, init?: any) => {
    const u = String(url);
    if (u.includes("/models")) return Response.json(MODELS);
    if (u.includes("venice.ai") && u.includes("/image/generate")) {
      calls.veniceBodies.push(JSON.parse(init.body));
      const status = opts.veniceStatus ?? 200;
      if (status !== 200) return new Response("nope", { status });
      return Response.json({
        images: [opts.veniceImage ?? PNG.toString("base64")],
      });
    }
    if (u.includes("venice.ai") && u.includes("/image/edit")) {
      calls.veniceEditBodies.push(JSON.parse(init.body));
      const status = opts.veniceEditStatus ?? 200;
      if (status !== 200) return new Response("nope", { status });
      return new Response(new Uint8Array(PNG), {
        headers: { "content-type": "image/png" },
      });
    }
    if (u.endsWith("/images/generations/async") && init?.method === "POST") {
      const sent = JSON.parse(init.body);
      calls.sirayBodies.push(sent);
      if (opts.sirayFailModels?.includes(sent.model)) {
        return new Response("down", { status: 503 });
      }
      taskModel.set(`t${calls.sirayBodies.length}`, sent.model);
      return Response.json({
        data: { task_id: `t${calls.sirayBodies.length}` },
      });
    }
    if (u.includes("/images/generations/async/t")) {
      const failWith =
        opts.sirayPollFail?.[taskModel.get(u.split("/").pop()!) ?? ""];
      if (failWith) {
        return Response.json({
          data: { status: failWith.status, fail_reason: failWith.reason },
        });
      }
      return Response.json({
        data: { status: "SUCCESS", outputs: ["https://files.example/x.jpg"] },
      });
    }
    if (u === "https://files.example/x.jpg") {
      return new Response(new Uint8Array(opts.sirayImage ?? JPG));
    }
    return new Response("unexpected " + u, { status: 500 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  resetAttemptLog();
  resetImageModelCache();
});

describe("small helpers", () => {
  it("trims on a word edge", () => {
    expect(fitPrompt("aaa bbb ccc", 8)).toBe("aaa bbb");
    expect(fitPrompt("short", 50)).toBe("short");
  });
  it("sniffs file types", () => {
    expect(sniffExtension(PNG)).toBe(".png");
    expect(sniffExtension(JPG)).toBe(".jpg");
  });
  it("flags only flat dark pictures", () => {
    expect(statsLookBlank({ mean: 1, spread: 0 })).toBe(true);
    expect(statsLookBlank({ mean: 3, spread: 30 })).toBe(false);
    expect(statsLookBlank({ mean: 120, spread: 2 })).toBe(false);
    expect(statsLookBlank(null)).toBe(false);
  });
  it("caps attempts per hour", () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_HOUR; i++) {
      expect(reserveAttempt(1000)).toBe(true);
    }
    expect(reserveAttempt(1000)).toBe(false);
    expect(reserveAttempt(1000 + 3_600_001)).toBe(true);
  });
  it("finds provider keys by name", () => {
    const p = {
      "Venice AI": { apiKey: { value: "v" } },
      "Siray AI": { apiKey: { value: "s" } },
    };
    expect(findVeniceApiKey(p)).toBe("v");
    expect(findSirayApiKey(p)).toBe("s");
  });
});

describe("resolveChain", () => {
  it("puts a named engine first, then the rest of its style", () => {
    const names = resolveChain("siray-qwen-pro", "anime").map((e) => e.name);
    expect(names[0]).toBe("siray-qwen-pro");
    expect(names).toContain("venice-chroma");
    expect(names).not.toContain("venice-anime");
  });
  it("treats an unknown name as a Venice model id", () => {
    const first = resolveChain("flux-dev", "realistic")[0];
    expect(first.service).toBe("venice");
    expect(first.modelId).toBe("flux-dev");
  });
});

describe("generateImages", () => {
  it("uses Venice first and says so", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const r = await generateImages({
      prompt: "a red barn",
      negativePrompt: "text",
      keys: { venice: "k", siray: "s" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images).toHaveLength(1);
    expect(r.images[0].engine).toBe("venice-chroma");
    expect(r.images[0].fellBack).toBe(false);
    expect(calls.veniceBodies[0].safe_mode).toBe(false);
    expect(calls.veniceBodies[0].negative_prompt).toBe("text");
    expect(calls.sirayBodies).toHaveLength(0);
  });

  it("falls back to Siray when Venice refuses (422)", async () => {
    const { fetchImpl, calls } = fakeFetch({ veniceStatus: 422 });
    const r = await generateImages({
      prompt: "x",
      keys: { venice: "k", siray: "s" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images[0].engine).toBe("siray-seedream-5-pro");
    expect(r.images[0].fellBack).toBe(true);
    expect(r.images[0].ext).toBe(".jpg");
    expect(r.images[0].notes.join(" ")).toMatch(/refused/);
    expect(calls.sirayBodies[0].output_format).toBe("jpg");
  });

  it("skips Venice quietly when only a Siray key exists", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const r = await generateImages({
      prompt: "x",
      keys: { siray: "s" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images[0].engine).toMatch(/siray/);
    expect(calls.veniceBodies).toHaveLength(0);
  });

  it("remakes a black dud, then moves on if it stays black", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    let n = 0;
    const sampler: PixelSampler = async () =>
      ++n <= 2 ? { mean: 0, spread: 0 } : { mean: 90, spread: 40 };
    const r = await generateImages({
      prompt: "x",
      keys: { venice: "k" },
      fetchImpl,
      sleep: noSleep,
      sampler,
    });
    expect(r.images[0].engine).toBe("venice-chroma");
    expect(calls.veniceBodies).toHaveLength(3);

    resetAttemptLog();
    const black: PixelSampler = async () => ({ mean: 0, spread: 0 });
    const r2 = await generateImages({
      prompt: "x",
      keys: { venice: "k" },
      fetchImpl,
      sleep: noSleep,
      sampler: black,
    });
    expect(r2.images).toHaveLength(0);
    expect(r2.failures[0]).toMatch(/black/);
  });

  it("makes several at once, capped at 4", async () => {
    const { fetchImpl } = fakeFetch({});
    const r = await generateImages({
      prompt: "x",
      count: 9,
      keys: { venice: "k" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images).toHaveLength(4);
  });

  it("stops when the hourly cap is used up", async () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_HOUR; i++) reserveAttempt();
    const { fetchImpl, calls } = fakeFetch({});
    const r = await generateImages({
      prompt: "x",
      keys: { venice: "k" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.capped).toBe(true);
    expect(r.images).toHaveLength(0);
    expect(calls.veniceBodies).toHaveLength(0);
  });
});

describe("editing a base picture", () => {
  const base = { bytes: PNG, mime: "image/png" };

  it("sends the base picture to the i2i engine and nothing else", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const r = await generateImages({
      prompt: "sitting on a sofa",
      aspect: "2:3",
      baseImage: base,
      keys: { siray: "s" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images).toHaveLength(1);
    expect(r.images[0].engine).toBe("siray-seedream-4-5-i2i");
    expect(r.images[0].fellBack).toBe(false);
    expect(calls.veniceBodies).toHaveLength(0);
    const body = calls.sirayBodies[0];
    expect(body.model).toBe("bytedance/seedream-4.5-i2i-spicy");
    expect(body.image).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    expect(body.size).toBe("1664x2496");
    expect(body.prompt).toBe("sitting on a sofa");
  });

  it("never makes a text-only picture on its own, and offers one when all fail", async () => {
    const { fetchImpl, calls } = fakeFetch({
      veniceEditStatus: 503,
      sirayFailModels: [
        "bytedance/seedream-4.5-i2i-spicy",
        "bytedance/seedream-5.5-i2i-spicy",
        "bytedance/seedream-5.0-pro-i2i-spicy",
      ],
    });
    const r = await generateImages({
      prompt: "x",
      baseImage: base,
      keys: { venice: "k", siray: "s" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images).toHaveLength(0);
    expect(r.textOnlyOffer).toBe(true);
    expect(calls.veniceBodies).toHaveLength(0); // no text-only generate calls
    expect(calls.sirayBodies.every((b) => b.model.includes("i2i"))).toBe(true);
    expect(calls.veniceEditBodies).toHaveLength(1); // the uncensored Venice edit engine tried
    expect(r.failures[0]).toMatch(/seedream-4-5-i2i/);
  });

  it("with no keys at all, skips every engine and still offers", async () => {
    const { fetchImpl } = fakeFetch({});
    const r = await generateImages({
      prompt: "x",
      baseImage: base,
      keys: {},
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images).toHaveLength(0);
    expect(r.textOnlyOffer).toBe(true);
    expect(r.failures[0]).toMatch(/no siray key/);
    expect(r.failures[0]).toMatch(/no venice key/);
  });

  it("has an i2i chain of at least three engines on both services", () => {
    const chain = resolveI2iChain(undefined);
    expect(chain.length).toBeGreaterThanOrEqual(3);
    expect(new Set(chain.map((e) => e.service))).toEqual(
      new Set(["siray", "venice"]),
    );
    expect(chain.every((e) => e.kind === "image-to-image")).toBe(true);
    // Only uncensored engines belong in her chain.
    expect(
      chain.every(
        (e) => /spicy/.test(e.modelId) || /uncensored/.test(e.modelId),
      ),
    ).toBe(true);
    const named = resolveI2iChain("venice-qwen-edit").map((e) => e.name);
    expect(named[0]).toBe("venice-qwen-edit");
    expect(named).toHaveLength(chain.length);
  });

  it("tries Venice first and never touches Siray when Venice works", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const r = await generateImages({
      prompt: "sitting on a sofa",
      aspect: "2:3",
      baseImage: base,
      keys: { venice: "k", siray: "s" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images).toHaveLength(1);
    expect(r.images[0].engine).toBe("venice-qwen-edit");
    expect(r.images[0].fellBack).toBe(false);
    expect(r.textOnlyOffer).toBe(false);
    expect(calls.sirayBodies).toHaveLength(0);
    const body = calls.veniceEditBodies[0];
    expect(body.model).toBe("qwen-edit-uncensored");
    expect(body.image).toBe(PNG.toString("base64"));
    expect(body.aspect_ratio).toBe("2:3");
    expect(body.safe_mode).toBe(false);
  });

  it("falls to Siray as the backup when Venice fails, with no offer", async () => {
    const { fetchImpl, calls } = fakeFetch({ veniceEditStatus: 503 });
    const r = await generateImages({
      prompt: "x",
      baseImage: base,
      keys: { venice: "k", siray: "s" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images[0].engine).toBe("siray-seedream-4-5-i2i");
    expect(r.images[0].fellBack).toBe(true);
    expect(r.textOnlyOffer).toBe(false);
    expect(calls.sirayBodies).toHaveLength(1);
  });

  it("reads Siray's FAILURE status as a real failure, not a timeout", async () => {
    const { fetchImpl } = fakeFetch({
      sirayPollFail: {
        "bytedance/seedream-4.5-i2i-spicy": {
          status: "FAILURE",
          reason: "input image rejected",
        },
      },
    });
    const r = await generateImages({
      prompt: "x",
      baseImage: base,
      keys: { siray: "s" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images[0].engine).toBe("siray-seedream-5-pro-i2i");
    expect(r.images[0].notes.join(" ")).toMatch(/input image rejected/);
    expect(r.images[0].notes.join(" ")).not.toMatch(/timed out/);
  });

  it("a Siray-only user gets the 5.0 Pro array form as the second try", async () => {
    const { fetchImpl, calls } = fakeFetch({
      sirayFailModels: ["bytedance/seedream-4.5-i2i-spicy"],
    });
    const r = await generateImages({
      prompt: "x",
      baseImage: base,
      keys: { siray: "s" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(r.images[0].engine).toBe("siray-seedream-5-pro-i2i");
    expect(calls.sirayBodies[1].model).toBe(
      "bytedance/seedream-5.0-pro-i2i-spicy",
    );
    const body = calls.sirayBodies[1];
    expect(body.images).toEqual([
      `data:image/png;base64,${PNG.toString("base64")}`,
    ]);
    expect(body.image).toBeUndefined();
  });

  it("does not run the i2i engine without a base picture", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const r = await generateImages({
      prompt: "x",
      model: "siray-seedream-4-5-i2i",
      keys: { siray: "s" },
      fetchImpl,
      sleep: noSleep,
      sampler: goodSampler,
    });
    expect(calls.sirayBodies.every((b) => b.image === undefined)).toBe(true);
    expect(r.images[0]?.engine ?? "").not.toBe("siray-seedream-4-5-i2i");
  });
});
