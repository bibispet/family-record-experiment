// Sets FAMILY_RECORD_ALLOW_LOCAL_IDENTITY=1 so that
// `import.meta.env?.DEV ?? (process.env?.FAMILY_RECORD_ALLOW_LOCAL_IDENTITY === "1")`
// evaluates to true in tsx (where import.meta.env is undefined). This lets tests
// exercise the dev route handlers' runtime guard (assertLocalIdentityDevelopmentOnly)
// directly. The built production worker is unaffected — its import.meta.env.DEV is
// false (not nullish), so ?? short-circuits and the env var is never consulted.
//
// One flag per boundary: FAMILY_RECORD_ALLOW_LOCAL_IDENTITY already gates the
// local identity adapter. The dev routes reuse it rather than introducing a
// separate DEV_MODE that an unrelated environment could trip.
process.env.FAMILY_RECORD_ALLOW_LOCAL_IDENTITY = "1";
