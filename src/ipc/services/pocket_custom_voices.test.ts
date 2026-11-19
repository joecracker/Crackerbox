// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listCustomPocketVoices,
  resolveCustomPocketVoice,
} from "./pocket_custom_voices";

let dir = "";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-myvoices-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const put = (name: string) => fs.writeFileSync(path.join(dir, name), "x");

describe("listCustomPocketVoices", () => {
  it("lists voice files by name, labelled as the user's own", () => {
    put("Grandma.wav");
    put("Bob Smith.flac");
    put("notes.txt");
    put("readme");
    expect(listCustomPocketVoices(dir).map((v) => [v.id, v.label])).toEqual([
      ["custom:Bob Smith", "Bob Smith (my voice)"],
      ["custom:Grandma", "Grandma (my voice)"],
    ]);
  });

  it("prefers a saved .safetensors voice over a sound file of the same name", () => {
    put("Ann.wav");
    put("Ann.safetensors");
    const [voice] = listCustomPocketVoices(dir);
    expect(path.basename(voice.file)).toBe("Ann.safetensors");
    expect(listCustomPocketVoices(dir)).toHaveLength(1);
  });

  it("skips folders, hidden files and names that are too long", () => {
    fs.mkdirSync(path.join(dir, "folder.wav"));
    put(".hidden.wav");
    put("x".repeat(60) + ".wav");
    put("ok.WAV");
    expect(listCustomPocketVoices(dir).map((v) => v.id)).toEqual(["custom:ok"]);
  });

  it("is empty when the folder is not there", () => {
    expect(listCustomPocketVoices(path.join(dir, "nope"))).toEqual([]);
  });
});

describe("resolveCustomPocketVoice", () => {
  it("finds the file for a listed voice", () => {
    put("Ann.wav");
    expect(resolveCustomPocketVoice(dir, "custom:Ann")).toBe(
      path.join(dir, "Ann.wav"),
    );
  });

  it("never points outside the folder, whatever the id says", () => {
    put("Ann.wav");
    for (const id of [
      "custom:../Ann",
      "custom:..\..\secret",
      "custom:C:\Windows\win",
      "custom:",
      "azelma",
      "custom:Missing",
    ]) {
      expect(resolveCustomPocketVoice(dir, id)).toBeNull();
    }
  });
});
