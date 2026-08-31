// Build-time guard: import.meta.env.DEV is replaced with false in production
// builds, making the preview content dead code that the minifier removes.
// The route still exists (the router discovers it by file path) but it
// returns 404 via notFound() — the sample data, CSS, and SVG are eliminated
// from the production bundle entirely.
//
// Deny-by-default: when import.meta.env is not substituted (tsx, direct
// imports, SSR paths, a different bundler), the expression evaluates to
// false. Vite replaces import.meta.env with a JSON object so the
// expression evaluates to true in dev and false in production.
const isDev = import.meta.env?.DEV ?? false;
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Lore — preview",
  robots: { index: false, follow: false },
};

// Sample data only. This route is a design preview and reads nothing real.
const PEOPLE = {
  motherLine: { label: "Millie Stewart", locked: true },
  fatherLine: { label: "Bob Stewart", locked: false },
};

export default function PreviewPage() {
  if (isDev) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <main className="lore-canvas">
          <header className="lore-top">
            <span className="lore-wordmark">L O R E</span>
            <div className="lore-mode" role="group" aria-label="Mode">
              <button className="lore-mode-btn is-active" type="button">View</button>
              <button className="lore-mode-btn" type="button">Edit</button>
            </div>
          </header>

          <ol className="lore-ruler" aria-label="Generations">
            <li>G3</li>
            <li>G2</li>
            <li>G1</li>
            <li className="is-current">G0</li>
          </ol>

          <svg className="lore-graph" viewBox="0 0 720 470" role="img"
               aria-label="Two forebears joining at a shared node, descending to you">
            <defs>
              <radialGradient id="sphereLight" cx="35%" cy="30%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="65%" stopColor="#e2e0da" />
                <stop offset="100%" stopColor="#b9b6ad" />
              </radialGradient>
              <radialGradient id="sphereDark" cx="35%" cy="28%">
                <stop offset="0%" stopColor="#6d6a63" />
                <stop offset="55%" stopColor="#2b2a27" />
                <stop offset="100%" stopColor="#111110" />
              </radialGradient>
              <filter id="lift" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="6" stdDeviation="7" floodOpacity="0.18" />
              </filter>
            </defs>

            <path className="lore-edge" d="M155,97 C230,150 300,175 360,233" />
            <path className="lore-edge" d="M566,96 C500,150 425,175 362,233" />
            <path className="lore-edge" d="M361,244 L361,325" />
            <path className="lore-edge" d="M361,366 L361,447" />

            <circle cx="155" cy="97" r="17" fill="url(#sphereLight)" filter="url(#lift)" />
            <circle cx="566" cy="96" r="17" fill="url(#sphereDark)" filter="url(#lift)" />

            <g className="lore-joint">
              <circle cx="361" cy="234" r="10" />
              <text x="361" y="237">G1</text>
            </g>

            <g className="lore-you">
              <circle cx="361" cy="345" r="22" filter="url(#lift)" />
              <text x="361" y="349">YOU</text>
            </g>

            <g className="lore-joint">
              <circle cx="361" cy="455" r="10" />
              <text x="361" y="458">G0</text>
            </g>
          </svg>

          <article className="lore-card lore-card-upper">
            <div className="lore-card-head">
              <span className="lore-avatar" aria-hidden="true" />
              <span className="lore-name">{PEOPLE.motherLine.label}</span>
              <span className="lore-chev" aria-hidden="true">⌄</span>
            </div>
            <div className="lore-redacted" aria-label="Details you cannot see">
              <span /><span /><span />
            </div>
            <span className="lore-lock" title="You can see who this is, not their details">🔒</span>
          </article>

          <article className="lore-card lore-card-lower">
            <div className="lore-card-head">
              <span className="lore-avatar" aria-hidden="true" />
              <span className="lore-name">{PEOPLE.fatherLine.label}</span>
              <span className="lore-chev" aria-hidden="true">⌄</span>
            </div>
          </article>

          <button className="lore-step" type="button" aria-label="Next">›</button>
          <button className="lore-spark" type="button" aria-label="Assist">✦</button>
        </main>
      </>
    );
  }
  notFound();
}

const CSS = `
.lore-canvas {
  position: relative;
  min-height: 100vh;
  background-color: #fbfbfa;
  background-image: radial-gradient(#d3d1cb 1px, transparent 1px);
  background-size: 22px 22px;
  font-family: var(--font-sans), system-ui, sans-serif;
  color: #171714;
  overflow: hidden;
}
.lore-top {
  position: relative; z-index: 2;
  display: flex; align-items: center; justify-content: center;
  padding: 22px 24px;
}
.lore-wordmark { font-size: 15px; font-weight: 600; letter-spacing: .34em; }
.lore-mode {
  position: absolute; right: 24px; top: 16px;
  display: flex; padding: 3px; border-radius: 999px;
  background: #edecE8; box-shadow: inset 0 1px 2px rgba(0,0,0,.09);
}
.lore-mode-btn {
  border: 0; background: transparent; cursor: pointer;
  padding: 5px 15px; border-radius: 999px;
  font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #6a6862;
}
.lore-mode-btn.is-active { background: #fff; color: #171714; box-shadow: 0 1px 3px rgba(0,0,0,.14); }

.lore-ruler {
  position: absolute; right: 26px; top: 68px; z-index: 2;
  margin: 0; padding: 14px 16px; list-style: none;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  border-radius: 14px; background: rgba(255,255,255,.82);
  box-shadow: 0 1px 3px rgba(0,0,0,.10); font-size: 11px; color: #8a877f;
}
.lore-ruler li { position: relative; letter-spacing: .08em; }
.lore-ruler li + li::before {
  content: ""; position: absolute; left: 50%; top: -14px;
  width: 1px; height: 10px; background: #d6d4cd;
}
.lore-ruler .is-current { color: #171714; font-weight: 700; }

.lore-graph { position: absolute; inset: 0; width: 100%; height: 100%; }
.lore-edge { fill: none; stroke: #1a1a17; stroke-width: 2.2; }
.lore-joint circle { fill: #1a1a17; }
.lore-joint text {
  fill: #fff; font-size: 8px; text-anchor: middle; letter-spacing: .06em;
}
.lore-you circle { fill: #17170f; }
.lore-you text {
  fill: #fff; font-size: 11px; text-anchor: middle; letter-spacing: .1em; font-weight: 600;
}

.lore-card {
  position: absolute; z-index: 2; width: 196px;
  background: #fff; border: 1px solid #e4e2db; border-radius: 12px;
  padding: 12px 13px; box-shadow: 0 2px 10px rgba(0,0,0,.06);
}
.lore-card-upper { left: 26px; top: 96px; padding-bottom: 34px; }
.lore-card-lower { left: 214px; top: 328px; }
.lore-card-head { display: flex; align-items: center; gap: 9px; }
.lore-avatar {
  width: 17px; height: 17px; border-radius: 50%;
  background: #e9e7e1; border: 1px solid #d8d5cd; flex: none;
}
.lore-name { font-size: 13px; flex: 1; }
.lore-chev { color: #9b988f; font-size: 13px; }
.lore-redacted { margin-top: 14px; display: flex; flex-direction: column; gap: 11px; }
.lore-redacted span { display: block; height: 1px; background: #dedbd4; }
.lore-redacted span:nth-child(1) { width: 100%; }
.lore-redacted span:nth-child(2) { width: 100%; }
.lore-redacted span:nth-child(3) { width: 58%; }
.lore-lock {
  position: absolute; right: 11px; bottom: 9px; font-size: 12px; opacity: .65;
}

.lore-step, .lore-spark {
  position: absolute; z-index: 2; cursor: pointer;
  display: grid; place-items: center; border-radius: 999px;
}
.lore-step {
  left: 410px; top: 332px; width: 30px; height: 22px;
  border: 1px solid #dcd9d2; background: #fff; color: #55524b; font-size: 14px;
}
.lore-spark {
  right: 26px; bottom: 26px; width: 42px; height: 42px; border: 0;
  background: linear-gradient(150deg, #f0f0ee, #cfcdc6);
  box-shadow: 0 3px 10px rgba(0,0,0,.16); color: #3d3b35; font-size: 17px;
}

@media (prefers-color-scheme: dark) {
  .lore-canvas { background-color: #131311; background-image: radial-gradient(#2e2d29 1px, transparent 1px); color: #f2f1ec; }
  .lore-mode { background: #232220; }
  .lore-mode-btn { color: #96938b; }
  .lore-mode-btn.is-active { background: #38362f; color: #fff; }
  .lore-ruler { background: rgba(30,29,26,.85); color: #8d8a82; }
  .lore-ruler .is-current { color: #fff; }
  .lore-ruler li + li::before { background: #3a3833; }
  .lore-edge { stroke: #e9e7e0; }
  .lore-joint circle { fill: #e9e7e0; }
  .lore-joint text { fill: #131311; }
  .lore-you circle { fill: #f4f2ea; }
  .lore-you text { fill: #131311; }
  .lore-card { background: #1c1b19; border-color: #33312c; }
  .lore-avatar { background: #2b2a26; border-color: #3b3934; }
  .lore-redacted span { background: #35332e; }
  .lore-step { background: #1c1b19; border-color: #33312c; color: #b5b2aa; }
}
`;
