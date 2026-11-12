# housemaster

Build and install helpers for the Crackerbox house (Dextra's tools).

- `make.cmd` runs `npm run make`, logs to `%USERPROFILE%\Documents\cb-install\make.log` (ends `MAKE-EXIT-<code>`).
- `run-install.ps1` (Crackerbox must be closed): disables KeepAlive, backs up settings/db by copy, runs `install.ps1` via a one-time scheduled task as the current user, re-enables KeepAlive.
- `install.ps1` removes the old `app-<version>` folder, runs the newest Setup.exe, compares `app.asar` hashes, writes `install-result.txt`.

Full playbook: Dextra's room, `docs/dextra/playbooks/build-and-install.md`.
