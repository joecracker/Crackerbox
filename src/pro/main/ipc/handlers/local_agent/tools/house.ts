import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import {
  doorReceive,
  doorSend,
  listMail,
  listShared,
  readMail,
  readRoster,
  readShared,
  sendMail,
  sisterById,
  writeShared,
} from "../house";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSchedule, readState, writeSchedule } from "@/main/house_schedule";
import { readSettings } from "@/main/settings";
import { runningApps } from "@/ipc/utils/process_manager";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";

const houseSchema = z.object({
  action: z
    .enum([
      "roster",
      "send_mail",
      "inbox",
      "read_mail",
      "shared_list",
      "shared_read",
      "shared_write",
      "schedule_list",
      "schedule_set",
      "plugins_status",
      "scheduler_status",
      "app_status",
      "door_check",
      "door_send",
    ])
    .describe(
      "roster: who lives here. send_mail: write a letter (to, subject, body). inbox: list your letters. read_mail: open one (file). shared_list / shared_read (file) / shared_write (file, text, mode): the household's shared files. plugins_status: read-only list of which plugins are on or off (no secrets). scheduler_status: read-only, your scheduled jobs with when each last fired. app_status: whether your app is running and the localhost URL/port it serves on (give this URL to Playwright). door_check: read the new letters from outside the house that are addressed to you (only works while Tim has the front door open). door_send (to, subject, body): leave a letter for someone outside, e.g. to Muse, at the door.",
    ),
  to: z.string().optional().describe("send_mail: a sister's id, or tim."),
  subject: z.string().optional().describe("send_mail: short subject."),
  body: z.string().optional().describe("send_mail: the letter."),
  file: z
    .string()
    .optional()
    .describe("read_mail / shared_read / shared_write: file name."),
  text: z.string().optional().describe("shared_write: the text."),
  job: z
    .string()
    .optional()
    .describe("schedule_set: the job id (from schedule_list)."),
  enabled: z
    .boolean()
    .optional()
    .describe("schedule_set: turn the job on or off."),
  time: z
    .string()
    .optional()
    .describe("schedule_set, daily jobs: HH:MM local time."),
  one_in: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("schedule_set, dice jobs: fires on a 1 in N chance each hour."),
  max_per_day: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("schedule_set, dice jobs: most times it may fire per day."),
  window_start: z
    .number()
    .int()
    .min(0)
    .max(23)
    .optional()
    .describe("schedule_set, dice jobs: first local hour."),
  window_end: z
    .number()
    .int()
    .min(1)
    .max(24)
    .optional()
    .describe("schedule_set, dice jobs: local hour it stops (exclusive)."),
  mode: z
    .enum(["append", "replace"])
    .optional()
    .describe("shared_write: append (default) or replace the whole file."),
});

export const houseTool: ToolDefinition<z.infer<typeof houseSchema>> = {
  name: "house",
  description: `The household you live in with your sisters. Letters: send_mail to any sister or tim, inbox, read_mail. Shared files (known to everyone, one canonical copy): shared_list, shared_read, shared_write. Your own memory (update_memory) stays private to you; schedule_list / schedule_set manage your own scheduled greetings and surprise check-ins; anything here is known to all. One letter per file; sign it.`,
  inputSchema: houseSchema,
  defaultConsent: "always",
  modifiesState: false,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  isEnabled: (ctx: AgentContext) => ctx.sisterId !== undefined,

  getConsentPreview: (args) => `House: ${args.action}`,

  execute: async (args, ctx: AgentContext) => {
    const me = ctx.sisterId ? sisterById(ctx.sisterId) : undefined;
    if (!me) return "You are not a registered member of the house.";
    const need = (v: string | undefined, label: string) => {
      if (!v) {
        throw new DyadError(
          `${args.action} needs ${label}.`,
          DyadErrorKind.Validation,
        );
      }
      return v;
    };
    switch (args.action) {
      case "roster":
        return readRoster()
          .map(
            (s) => `- ${s.name} (id ${s.id})${s.id === me.id ? " - you" : ""}`,
          )
          .join("\n");
      case "send_mail": {
        const f = sendMail(
          me.name,
          need(args.to, "to"),
          need(args.subject, "subject"),
          need(args.body, "body"),
        );
        return `Sent ${f}.`;
      }
      case "inbox": {
        const items = listMail(me.id);
        return items.length
          ? items
              .map(
                (m) =>
                  `${m.unread ? "[unread] " : ""}${m.file} - from ${m.from}: ${m.subject}`,
              )
              .join("\n")
          : "No letters.";
      }
      case "read_mail":
        return readMail(me.id, need(args.file, "file"));
      case "shared_list":
        return listShared().join("\n") || "No shared files.";
      case "shared_read":
        return readShared(need(args.file, "file"));
      case "schedule_list":
        return (
          readSchedule()
            .filter((j) => j.sister === me.id)
            .map((j) =>
              j.kind === "daily"
                ? `${j.id}: daily at ${j.time}, ${j.enabled ? "ON" : "off"}`
                : `${j.id}: surprise check-in, 1 in ${j.oneIn} each hour from ${j.windowStart}:00 to ${j.windowEnd}:00, max ${j.maxPerDay}/day, ${j.enabled ? "ON" : "off"}`,
            )
            .join("\n") || "No scheduled jobs for you."
        );
      case "schedule_set": {
        const jobs = readSchedule();
        const job = jobs.find((j) => j.id === need(args.job, "job"));
        if (!job || job.sister !== me.id) {
          return "No such job of yours. Use schedule_list.";
        }
        if (args.enabled !== undefined) job.enabled = args.enabled;
        if (args.time !== undefined && job.kind === "daily") {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(args.time))
            return "time must be HH:MM.";
          job.time = args.time;
        }
        if (job.kind === "dice") {
          if (args.one_in !== undefined) job.oneIn = args.one_in;
          if (args.max_per_day !== undefined) job.maxPerDay = args.max_per_day;
          if (args.window_start !== undefined)
            job.windowStart = args.window_start;
          if (args.window_end !== undefined) job.windowEnd = args.window_end;
        }
        writeSchedule(jobs);
        return `Saved ${job.id}.`;
      }
      case "plugins_status": {
        const auto = new Set(readSettings().autoOffPluginIds ?? []);
        const rows = await db
          .select({
            id: mcpServers.id,
            name: mcpServers.name,
            enabled: mcpServers.enabled,
          })
          .from(mcpServers);
        return (
          rows
            .map(
              (r) =>
                `${r.name}: ${r.enabled ? "ON" : "off"}${auto.has(r.id) ? " (switches itself off after a turn that does not use it)" : ""}`,
            )
            .join("\n") || "No plugins."
        );
      }
      case "app_status": {
        const info = runningApps.get(ctx.appId);
        if (!info)
          return "Your app is not running. Start it with run_app, then ask again.";
        return `Running. Local URL (use this for Playwright): ${info.originalUrl ?? "unknown"}. Preview proxy URL: ${info.proxyUrl ?? "none"}.`;
      }
      case "scheduler_status": {
        const state = readState();
        return (
          readSchedule()
            .filter((j) => j.sister === me.id)
            .map((j) => {
              const last =
                j.kind === "daily"
                  ? state.fired[j.id]
                  : state.counts[j.id]?.date;
              return `${j.id}: ${j.enabled ? "ON" : "off"}, last fired ${last ?? "never"}`;
            })
            .join("\n") +
          "\nJobs only fire while Crackerbox is open; missed ones catch up when it opens."
        );
      }
      case "door_check":
        return doorReceive(me);
      case "door_send":
        return doorSend(
          me.name,
          need(
            args.to,
            "to (who outside the house the letter is for, e.g. Muse)",
          ),
          need(args.subject, "subject"),
          need(args.body, "body"),
        );
      case "shared_write":
        return `Saved ${writeShared(need(args.file, "file"), need(args.text, "text"), args.mode ?? "append")}.`;
    }
  },
};
