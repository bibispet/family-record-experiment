# Lore demo deployment

This is a public interaction demo, not a private family archive. Every visible
person, relationship, story, and media caption comes from the checked-in
fictional seed. The deployed interface is read-only: it renders no capture,
upload, edit, delete, or sharing controls. It does not open D1 or R2 to render
the demo, and direct API requests remain deny-by-default.

The site-wide yellow banner is part of the safety boundary. Do not remove it,
enable mutations, add capture controls, or use real family information in this
deployment.
Cloudflare request observability stays disabled because page URLs can contain
record UUIDs.

## Build and verify from a clean clone

Prerequisites: Git, npm, and Node.js 22.13 or newer.

```sh
git clone https://github.com/bibispet/family-record-experiment.git lore-demo
cd lore-demo
git switch main
git pull --ff-only
npm ci
npm test
npm run demo:verify
```

`npm test` creates the production build. `npm run demo:verify` then refuses the
build unless the Sites project has real logical `DB` and `MEDIA` resources, the
generated Wrangler configuration has `observability.enabled: false`, all
site-creator placeholder IDs/names are absent, the global read-only warning is
present, and `/family` is wired to the compiled fictional snapshot without
capture controls.

## Publish

Open the clean checkout in Codex and ask it to publish the existing Sites
project recorded in `.openai/hosting.json`. Sites owns the real D1 and R2
resource IDs; do not create replacement resources or paste account credentials
into source. Publish the already verified commit, preserve public access for the
phone trial, and stop if the platform presents a paid-plan or new lock-in
decision.

After publishing, open `/`, `/family`, and `/family/graph` from a phone. Confirm
the read-only demo banner remains visible, the fictional Adeyemi seed loads,
the family graph can be dragged and explored, no capture or upload fields are
present, and anonymous API requests still return 401. Roll back by redeploying
the preceding Sites version; the demo writes no visitor data that needs
migration or cleanup.
