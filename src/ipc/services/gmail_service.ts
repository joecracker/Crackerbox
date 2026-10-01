import { safeStorage, shell } from "electron";
import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { getUserDataPath } from "@/paths/paths";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GoogleCredentialsFile = z.object({
  installed: z.object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
  }),
});
const GmailCredentials = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().optional(),
});
type GmailCredentials = z.infer<typeof GmailCredentials>;

let cache: GmailCredentials | undefined;
let server: Server | undefined;

function credentialPath() {
  return path.join(getUserDataPath(), "gmail-send.enc");
}

function requireEncryption() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows secure credential storage is unavailable.");
  }
}

function load(): GmailCredentials | undefined {
  if (cache) return cache;
  const target = credentialPath();
  if (!fs.existsSync(target)) return undefined;
  requireEncryption();
  cache = GmailCredentials.parse(
    JSON.parse(safeStorage.decryptString(fs.readFileSync(target))),
  );
  return cache;
}

function save(credentials: GmailCredentials) {
  requireEncryption();
  const target = credentialPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    `${target}.tmp`,
    safeStorage.encryptString(JSON.stringify(credentials)),
    { mode: 0o600 },
  );
  fs.renameSync(`${target}.tmp`, target);
  cache = credentials;
}

export function importGmailCredentials(filePath: string) {
  const source = GoogleCredentialsFile.parse(
    JSON.parse(fs.readFileSync(filePath, "utf8")),
  );
  save({
    clientId: source.installed.client_id,
    clientSecret: source.installed.client_secret,
  });
}

export function getGmailStatus() {
  const credentials = load();
  return {
    configured: Boolean(credentials),
    connected: Boolean(credentials?.refreshToken),
  };
}

export function disconnectGmail() {
  const credentials = load();
  if (credentials) save({ ...credentials, refreshToken: undefined });
}

export function forgetGmailCredentials() {
  server?.close();
  server = undefined;
  cache = undefined;
  fs.rmSync(credentialPath(), { force: true });
}

function sameState(expected: string, actual: string | null) {
  return (
    actual !== null &&
    Buffer.byteLength(expected) === Buffer.byteLength(actual) &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  );
}

export async function connectGmail(): Promise<void> {
  const credentials = load();
  if (!credentials) throw new Error("Import Google OAuth credentials first.");
  if (server) throw new Error("A Gmail connection is already in progress.");

  const state = randomBytes(32).toString("base64url");
  let redirectUri = "";

  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server?.close();
      server = undefined;
      reject(new Error("Gmail connection timed out. Try again."));
    }, 5 * 60_000);

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      const returnedCode = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      res.setHeader("Content-Type", "text/html; charset=utf-8");

      if (!returnedCode || !sameState(state, returnedState)) {
        res.end(
          "<h2>Gmail connection failed.</h2><p>You can close this window.</p>",
        );
        clearTimeout(timeout);
        server?.close();
        server = undefined;
        reject(
          new Error("Google returned an invalid Gmail authorization response."),
        );
        return;
      }

      res.end(
        "<h2>Gmail is connected to Crackerbox.</h2><p>You can close this window.</p>",
      );
      clearTimeout(timeout);
      server?.close();
      server = undefined;
      resolve(returnedCode);
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start the Gmail connection."));
        return;
      }
      redirectUri = `http://127.0.0.1:${address.port}`;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GMAIL_SEND_SCOPE,
        access_type: "offline",
        prompt: "consent",
        state,
      }).toString();
      void shell.openExternal(authUrl.toString());
    });
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok)
    throw new Error("Google did not complete the Gmail connection.");
  const tokens = z
    .object({ refresh_token: z.string().min(1) })
    .parse(await response.json());
  save({ ...credentials, refreshToken: tokens.refresh_token });
}

async function getAccessToken(): Promise<string> {
  const credentials = load();
  if (!credentials?.refreshToken) {
    throw new Error("Connect Gmail in Settings before sending email.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok)
    throw new Error(
      "Gmail authorization expired. Reconnect Gmail in Settings.",
    );
  return z
    .object({ access_token: z.string().min(1) })
    .parse(await response.json()).access_token;
}

function encodeHeader(value: string) {
  return /[^\x20-\x7E]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`
    : value;
}

export async function sendGmailMessage(input: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments?: Array<{ path: string; filename?: string }>;
}): Promise<string> {
  const envelopeHeaders = [
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${input.bcc.join(", ")}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
  ];
  let message: string;

  if (input.attachments?.length) {
    const boundary = `crackerbox_${randomBytes(18).toString("hex")}`;
    const parts = [
      ...envelopeHeaders,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.body,
    ];

    for (const attachment of input.attachments) {
      const filename = attachment.filename || path.basename(attachment.path);
      const extension = path.extname(filename).toLowerCase();
      const contentType =
        extension === ".pdf"
          ? "application/pdf"
          : extension === ".png"
            ? "image/png"
            : extension === ".jpg" || extension === ".jpeg"
              ? "image/jpeg"
              : extension === ".txt"
                ? "text/plain"
                : "application/octet-stream";
      const content = fs
        .readFileSync(attachment.path)
        .toString("base64")
        .match(/.{1,76}/g)
        ?.join("\r\n");
      parts.push(
        `--${boundary}`,
        `Content-Type: ${contentType}; name="${encodeHeader(filename)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${encodeHeader(filename)}"`,
        "",
        content ?? "",
      );
    }
    parts.push(`--${boundary}--`, "");
    message = parts.join("\r\n");
  } else {
    message = [
      ...envelopeHeaders,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.body,
    ].join("\r\n");
  }

  const raw = Buffer.from(message).toString("base64url");
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  if (!response.ok) throw new Error("Gmail could not send the message.");
  return z.object({ id: z.string() }).parse(await response.json()).id;
}
