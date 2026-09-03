// Pre-loaded via --import to register the cloudflare:workers resolver hook.
// Must be loaded BEFORE any code that imports db/runtime.ts or family-store.ts.
import Module from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const hooksUrl = pathToFileURL(join(__dirname, "cf-bindings-hooks.mjs")).href;

Module.register(hooksUrl, import.meta.url);
