// Lazy bridge so run_command does not load the house module (and Electron
// paths) until a command actually runs.
export { sisterForApp } from "../house";