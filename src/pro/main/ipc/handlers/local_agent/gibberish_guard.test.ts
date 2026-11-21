import { describe, expect, it } from "vitest";
import {
  GIBBERISH_WINDOW_CHARS,
  createGibberishGuard,
  looksLikeWordSalad,
} from "./gibberish_guard";

// Tiny seeded generator so the made-up text is the same on every run.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const LATIN = [
  "the",
  "lantern",
  "walked",
  "slowly",
  "toward",
  "harbor",
  "because",
  "morning",
  "river",
  "quiet",
  "remembered",
  "window",
  "letter",
  "garden",
  "carried",
  "evening",
];
const CYRILLIC = ["мир", "город", "человек", "время", "дорога", "книга"];
const ARABIC = ["كتاب", "مدينة", "طريق", "ماء", "زمن", "بيت"];
const THAI = ["เมือง", "น้ำ", "เวลา", "หนังสือ", "ถนน", "บ้าน"];
const DEVANAGARI = ["शहर", "पानी", "समय", "किताब", "रास्ता", "घर"];
const HAN = ["城市", "时间", "道路", "书本", "水源", "房子"];

function pick<T>(pool: T[], r: () => number): T {
  return pool[Math.floor(r() * pool.length)];
}

function story(chars: number, seed = 1): string {
  const r = rng(seed);
  let out = "";
  while (out.length < chars) {
    const n = 8 + Math.floor(r() * 10);
    const words: string[] = [];
    for (let i = 0; i < n; i++) words.push(pick(LATIN, r));
    out += words.join(" ") + ". ";
  }
  return out;
}

function salad(chars: number, seed = 7): string {
  const r = rng(seed);
  const pools = [LATIN, LATIN, CYRILLIC, ARABIC, THAI, DEVANAGARI, HAN];
  let out = "";
  while (out.length < chars) out += pick(pick(pools, r), r) + " ";
  return out;
}

function stream(guard: ReturnType<typeof createGibberishGuard>, text: string) {
  let result: number | null = null;
  for (let i = 0; i < text.length; i += 37) {
    result = guard.push(text.slice(i, i + 37), i);
    if (result !== null) break;
  }
  return result;
}

describe("gibberish guard", () => {
  it("never trips on a very long plain story", () => {
    const guard = createGibberishGuard();
    expect(stream(guard, story(400_000))).toBeNull();
    expect(guard.tripped).toBe(false);
  });

  it("lets a story keep a few foreign names and words", () => {
    const base = story(30_000, 3);
    // A foreign name or word every few sentences, as a real story would have.
    let count = 0;
    const spiced = base.replace(/\. /g, () =>
      ++count % 4 === 0
        ? ". Zoë and Müller said город, then عبد nearby. "
        : ". ",
    );
    const guard = createGibberishGuard();
    expect(stream(guard, spiced)).toBeNull();
  });

  it("lets text written fully in one other alphabet through", () => {
    for (const pool of [CYRILLIC, ARABIC, THAI, DEVANAGARI, HAN]) {
      const r = rng(11);
      let text = "";
      while (text.length < 20_000) text += pick(pool, r) + " ";
      const guard = createGibberishGuard();
      expect(stream(guard, text)).toBeNull();
    }
  });

  it("recognises a window of word salad", () => {
    expect(looksLikeWordSalad(salad(GIBBERISH_WINDOW_CHARS + 200))).toBe(true);
    expect(looksLikeWordSalad(story(GIBBERISH_WINDOW_CHARS + 200))).toBe(false);
  });

  it("stops a reply that turns to word salad and says where to cut back to", () => {
    const good = story(1500);
    const guard = createGibberishGuard();
    const cut = stream(guard, good + salad(6000));
    expect(cut).not.toBeNull();
    expect(guard.tripped).toBe(true);
    // The cut lands near the end of the good text, never inside the first window.
    expect(cut!).toBeGreaterThanOrEqual(GIBBERISH_WINDOW_CHARS);
    expect(cut!).toBeLessThanOrEqual(good.length + GIBBERISH_WINDOW_CHARS);
  });

  it("needs two salad windows in a row, so one odd stretch is forgiven", () => {
    const text =
      story(2400, 5) + salad(GIBBERISH_WINDOW_CHARS, 9) + story(8000, 6);
    const guard = createGibberishGuard();
    expect(stream(guard, text)).toBeNull();
  });

  it("starts counting from the offset it is given", () => {
    const guard = createGibberishGuard(400);
    const text = salad(2000);
    let cut: number | null = null;
    for (let i = 0; i < text.length && cut === null; i += 50) {
      cut = guard.push(text.slice(i, i + 50), 10_000 + i);
    }
    expect(cut).toBe(10_000);
  });
});
