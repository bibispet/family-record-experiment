import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hosting = JSON.parse(readFileSync(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
const wranglerText = readFileSync(new URL("../dist/server/wrangler.json", import.meta.url), "utf8");
const wrangler = JSON.parse(wranglerText);
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const familyPage = readFileSync(new URL("../app/family/page.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../app/family/FamilyDashboard.tsx", import.meta.url), "utf8");

assert.match(hosting.project_id ?? "", /^appgprj_/);
assert.equal(hosting.d1, "DB");
assert.equal(hosting.r2, "MEDIA");
assert.deepEqual(wrangler.observability, { enabled: false });
assert.doesNotMatch(wranglerText, /00000000-0000-4000-8000-000000000000|site-creator-d1|site-creator-r2/);
assert.match(layout, /Read-only demo\./);
assert.match(layout, /Nothing can be entered, uploaded, or saved\./);
assert.match(familyPage, /getDemoSnapshot\(\)/);
assert.match(familyPage, /demoMode/);
assert.match(dashboard, /!demoMode/);
assert.doesNotMatch(dashboard, /demoRequest/);

console.log("Demo deployment guardrails verified: fictional read-only snapshot, real Sites bindings, observability off.");
