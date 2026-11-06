import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { VENICE_API_BASE } from "./venice_api";
import { explainVeniceError } from "./venice_image";

// Cuts the background out of a picture with Venice's background-remove
// feature (same Venice key as image making). Returns a PNG with a transparent
// background.

export const BG_REMOVE_MAX_BYTES = 25 * 1024 * 1024;
const BG_REMOVE_TIMEOUT_MS = 120_000;

export async function removeBackgroundWithVenice({
  apiKey,
  bytes,
  signal,
  fetchImpl = fetch,
}: {
  apiKey: string;
  bytes: Buffer;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Buffer> {
  if (bytes.length > BG_REMOVE_MAX_BYTES) {
    throw new DyadError(
      "That picture is over 25 MB, which is more than Venice accepts for cutouts.",
      DyadErrorKind.Validation,
    );
  }
  const timeout = AbortSignal.timeout(BG_REMOVE_TIMEOUT_MS);
  const response = await fetchImpl(
    `${VENICE_API_BASE}/image/background-remove`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image: bytes.toString("base64") }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    },
  );
  if (!response.ok) {
    throw new DyadError(
      explainVeniceError(response.status, await response.text()),
      DyadErrorKind.External,
    );
  }
  const out = Buffer.from(await response.arrayBuffer());
  const isPng = out.length > 8 && out[0] === 0x89 && out[1] === 0x50;
  if (!isPng) {
    const peek = out.subarray(0, 120).toString("utf8").replace(/\s+/g, " ");
    throw new DyadError(
      `Venice did not send back a picture. ${peek}`.trim(),
      DyadErrorKind.External,
    );
  }
  return out;
}
