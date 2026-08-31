// Sets DEV_MODE=1 so that `import.meta.env?.DEV ?? (process.env?.DEV_MODE === "1")`
// evaluates to true in tsx (where import.meta.env is undefined). This lets tests
// exercise the dev route handlers' runtime guard (assertLocalIdentityDevelopmentOnly)
// directly. The built production worker is unaffected — its import.meta.env.DEV is
// false (not nullish), so ?? short-circuits and DEV_MODE is never consulted.
process.env.DEV_MODE = "1";
