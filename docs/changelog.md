# Crackerbox changelog

Highlights from the project history, newest first. The full list is `git log`.

## 2026-11-07

- Plugins: Context7, Sequential Thinking, GitHub and a custom ship-check server installed and tested.
- Plugin card: the assistant can offer to switch on your own installed-but-off plugins.
- Chats on custom providers (e.g. Venice) compact at 80k tokens instead of 120k.
- Image-to-image: one base picture shows who the subject is; pose and everything else follow your words. Single reference only.

## 2026-11-05 to 2026-11-06

- Image tool with many engines and automatic fallback.
- Media gallery: archive instead of delete, sections, pins, size display, cutout tool, Save As, Copy Image, Show in Folder, drag-out, right-click menu.
- Phone: share, save and copy pictures; fixed thumbnails.
- Agent chat fixes: no leaked thinking, no fake tool tags, handoff button on long chats.

## 2026-11-01 to 2026-11-03

- Header counter shows the Venice balance.
- Chat: distinct message bubbles with date and time, larger Send button; NUL-byte fix for custom providers.
- Looser prompt rules, 10 exchanges of chat memory, Venice thinking level low.

## 2026-10-29 to 2026-10-31

- Memory cabinet, handoff and New chat; memory overflow archives.
- Lighter chats: old tool output trimmed, chat library, earlier auto-summary, long-chat warning.
- Venice web search and Venice voice (hosted recordings, Kokoro as backup); Bluetooth audio kept awake.
- The assistant opens the Preview panel herself, investigates with step-budget awareness, and edits files outside the project only with permission.
- Open minimized setting; helper agents without a Dyad Pro key.

## 2026-10-25 (1.17.0-beta.2 to beta.5)

- Read-only access to files anywhere on the PC with credential folders blocked and secrets blanked; blocked-folders.txt is honored.
- Agent can look at a connected Android phone or emulator.
- Settings guard, dark default, README.

## 2026-10-12 to 2026-10-16

- Phone: Add a phone QR code, installable app icon, Cloudflare remote access ([phone-remote.md](phone-remote.md)), reconnect handling, project chat list.
- "Project" wording instead of "app" throughout.
- Voice: Kokoro kept, hosted voice sent in smaller pieces.
- Attachments: big photos shrunk before sending.
- Home Assistant restart tool that checks configuration first.
- Prompts: check first before any change; audit cleanup.
