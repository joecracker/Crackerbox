# Getting started with Crackerbox

Crackerbox is a local AI app builder for Windows. You chat, it builds and previews the app on your PC. It is a heavily remixed fork of [Dyad](https://github.com/dyad-sh/dyad).

Download: https://get.crackerbox.app/crackerbox/install/ (see the README for the Smart App Control note).

## First run

1. Install and open Crackerbox.
2. Add your own AI key in Settings (bring your own keys; nothing is bundled).
3. Create or import a project and start chatting. Looking at your project is free; changing it needs your go-ahead in any words.

## Plugins (MCP servers)

Plugins give the assistant extra tools (docs lookup, GitHub, browser, your own scripts).

- Open **Plugins > Add Plugin**. Fill in Name, Transport, Command, Args and any environment variables (tokens go in the environment field only, never in chat).
- On Windows, run npx-based servers as Command `cmd`, Args `/c npx -y <package>`. A plain `.exe` can be used directly.
- Each tool can be set to ask or deny.
- Tested set: Context7 (library docs), Sequential Thinking, GitHub (official server binary), and a custom `ship-check` server (checks a live site and scans a folder for leaked secrets).

### Keeping the assistant light

Every enabled plugin adds tool descriptions the model must carry. Leave rarely used plugins switched off. If the assistant needs one, it shows a card in chat offering to switch it on; click Connect and it is enabled. Plugins you added yourself (not from the catalog) are offered this way too.

## Images

The assistant can generate pictures through several engines with automatic fallback (Venice and Siray among them).

- **Image-to-image**: give a base picture of who the subject is (face, body, style). Describe the pose, outfit and scene in your own words; nothing is preprogrammed. If a result is off, say so and retry.
- The Siray image-to-image engine (`siray-seedream-4-5-i2i`) accepts exactly **one** reference image.
- Only the 2:3 size has been verified; other aspect ratios are best guesses.
- The Media gallery archives instead of deleting, with sections, pins, Save As, Copy Image, Show in Folder and drag-out.

## Long chats

- Custom-provider models (for example Venice) are summarized at 80,000 tokens so chats stay sharp.
- A long-chat warning and a Write handoff / New chat option carry the important decisions into a fresh chat.
- Per-project memory ("memory cabinet") keeps notes between chats.

## Phone

Scan the QR code in **Settings > Add a phone**. Away from home needs your own Cloudflare account: [phone-remote.md](phone-remote.md).

## Known limits

- Windows only, beta, not code-signed.
- Cloud features use your own keys and accounts; costs and rate limits are yours.
- Report bugs: https://github.com/joecracker/Crackerbox/issues

See [changelog.md](changelog.md) for what changed and when.
