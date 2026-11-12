# Crackerbox

**A vibe-coding workshop where your AI crew has personality.**

Crackerbox is a local, open-source harness for building software with a team of AI entities. Describe what you want, they build it, and you enjoy the ride. It is made for people who want creating software to feel good, not like a corporate IDE. Free beta for Windows, remixed from [Dyad](https://github.com/dyad-sh/dyad), with thanks to its makers.

## What makes it different

- **Pick your crew.** Every entity has its own room, memory and voice. Keep them blank and sterile, with a different model doing each job. Or go wild: three monsters who build for you, a professor in a library, a grumpy foreman, pieces of your family. They can work separate projects or share one, and you decide who is on which job.
- **They talk to each other.** Entities pass notes back and forth and share a common folder for files. Hand a job to one, let her leave instructions for another, and watch a working group form. It is a little silly, and it completes the circle.
- **Jobs are tabs.** Every chat is a job. Each tab shows who is on it, and you can swap the entity on a job at any time.
- **They reach you.** Entities can text you on Telegram, send mail, run on a schedule and keep their own memory. A front door lets outside messages in when you open it.
- **Bring your own keys.** Use the AI providers you already have, with no lock-in.
- **Extend it.** Add plugins (MCP servers: docs lookup, GitHub, your own tools). The assistant can ask you to switch one on when it needs it.
- **Images.** Several image engines with fallback, plus image-to-image from a base picture.
- **Local and private.** Your projects and your entities' memory stay on your PC. Windows only for now.

## Straight talk

Crackerbox is built to fit how I work. Feedback is welcome and I read it, but if an idea does not fit the vision, it does not go in.

## Documentation

- [Getting started](docs/getting-started.md): first run, plugins (MCP servers), image generation and image-to-image, long chats, known limits.
- [Changelog](docs/changelog.md): what changed and when.
- [Phone and remote access](docs/phone-remote.md)

## 📱 Phone

Open Crackerbox on your phone by scanning a code in **Settings > Add a phone**. Using it away from home needs your own Cloudflare account; see [docs/phone-remote.md](docs/phone-remote.md).

## 📦 Download

No sign-up required. Just download and go.

### [Download Crackerbox for Windows](https://get.crackerbox.app/crackerbox/install/)

> **If Windows says "Smart App Control blocked part of this app"** (with no way to continue): Smart App Control only allows apps Microsoft already knows, and Crackerbox is not code-signed yet. Open **Settings > Privacy & security > Windows Security > App & browser control > Smart App Control settings**, switch it **Off**, then run the installer again. On an up-to-date Windows you can switch it back on afterward; on an older build, turning it off is permanent without resetting Windows.

## 🤝 Community

Got an idea or hit a bug? Use [Discussions](https://github.com/joecracker/Crackerbox/discussions/new?category=ideas) or [Issues](https://github.com/joecracker/Crackerbox/issues/new). I read everything, but I only change things that make Crackerbox better for me too.

## 🛠️ Contributing

**Dyad** is open-source (see License info below).

If you're interested in contributing to dyad, please read our [contributing](./CONTRIBUTING.md) doc.

## License

- All the code in this repo outside of `src/pro` is open-source and licensed under Apache 2.0 - see [LICENSE](./LICENSE).
- All the code in this repo within `src/pro` is fair-source and licensed under [Functional Source License 1.1 Apache 2.0](https://fsl.software/) - see [LICENSE](./src/pro/LICENSE).
