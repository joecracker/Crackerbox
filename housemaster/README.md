# housemaster

Build and install helpers for the Crackerbox house (Dextra's tools).

- `make.cmd` runs `npm run make`, logs to `%USERPROFILE%\Documents\cb-install\make.log` (ends `MAKE-EXIT-<code>`).
- `run-install.ps1` (Crackerbox must be closed): disables KeepAlive, backs up settings/db by copy, runs `install.ps1` via a one-time scheduled task as the current user, re-enables KeepAlive.
- `install.ps1` removes the old `app-<version>` folder, runs the newest Setup.exe, compares `app.asar` hashes, writes `install-result.txt`.

Full playbook: Dextra's room, `docs/dextra/playbooks/build-and-install.md`.

## Keeping personal files out of GitHub

This repo is public. Files named in `personal-paths.txt` (names only, one per line; a trailing `/` means a folder) never go into a shared commit or a push:

- **The app**: the auto-commit sweep skips them, the uncommitted-files banner hides them, and the push button refuses commits that touch them (`src/ipc/utils/git_utils.ts`, `personal_paths.ts`).
- **Git on the command line**: `.husky/pre-commit` and `.husky/pre-push` block them, and also block text copied from the private prompt files in the house data folder (`check-private.mjs`, `check-push.mjs`, `private-lib.mjs`).
- **Private history**: `node housemaster/pgit.mjs init` (once) makes a local-only git history for those files, outside this repo (no remote). `pgit.mjs snapshot` saves them; the app also does it after each chat turn. `pgit.mjs check` confirms the shared repo tracks none of them.

Private wording used by code (for example a scheduled prompt) lives in `%APPDATA%\Crackerbox\house\prompts\` and is read at runtime, never written into the code.
