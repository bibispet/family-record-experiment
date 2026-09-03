// Resolver hook for `cloudflare:workers` and `?raw` SQL imports
// Used by the integration test harness via cf-bindings-setup.mjs

export function initialize() {}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      url: "data:text/javascript," + encodeURIComponent(
        "export const env = globalThis.__cfTestBindings ?? {};\n" +
        "export function getEnvironment() { return globalThis.__cfTestBindings ?? {}; }\n"
      ),
      format: "module",
      shortCircuit: true,
    };
  }

  // Intercept .sql?raw imports (vinext convention) and return the file as a
  // default export string. Without this, tsx can't handle the ?raw suffix.
  if (specifier.includes(".sql?raw")) {
    const next = await nextResolve(specifier.replace(/\?raw$/, ""), context);
    if (next.url) {
      return {
        url: next.url,
        format: "module",
        shortCircuit: true,
        // The load hook will handle reading the file; but we need to
        // signal that this is raw text. We use a different approach:
        // register a load hook that intercepts .sql files and returns
        // them as text modules.
      };
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  // For .sql files imported as raw text (vinext ?raw convention)
  if (url.endsWith(".sql")) {
    const fs = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const content = fs.readFileSync(fileURLToPath(url), "utf-8");
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(content)};`,
    };
  }
  return nextLoad(url, context);
}
