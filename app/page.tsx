import type { Metadata } from "next";
import Link from "next/link";
import { getRscViewer, getSignInPath } from "./lib/identity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Family Record Experiment" },
  description: "A private place for your family's people, photos, and stories.",
};

export default async function Home() {
  const viewer = await getRscViewer();
  const recordPath = viewer ? "/family" : getSignInPath("/family");

  return (
    <main className="welcome-shell">
      <nav className="welcome-nav" aria-label="Main navigation">
        <Link className="wordmark" href="/" aria-label="Family Record Experiment home">
          <span className="wordmark-mark" aria-hidden="true">F</span>
          <span>Family Record Experiment</span>
        </Link>
        {recordPath === null ? (
          <span className="button button-secondary" aria-disabled="true">Sign-in not configured</span>
        ) : (
          <a className="button button-secondary" href={recordPath}>
            {viewer ? "Open family record" : "Sign in"}
          </a>
        )}
      </nav>

      <section className="welcome-hero">
        <div className="welcome-copy">
          <p className="eyebrow">Made for one family, not an audience</p>
          <h1>Keep the people and stories that make you <em>you.</em></h1>
          <p className="welcome-lede">
            A calm, private place for family members, photographs, voice notes,
            and the stories you do not want to lose.
          </p>
          <div className="welcome-actions">
            {recordPath === null ? (
              <span className="button button-primary" aria-disabled="true">Sign-in not configured</span>
            ) : (
              <a className="button button-primary" href={recordPath}>
                {viewer ? "Open your family record" : "Start your family record"}
              </a>
            )}
            <span className="privacy-note">Private by default. No in-app analytics, feed, likes, or advertising.</span>
          </div>
        </div>

        <div className="record-preview" aria-label="A preview of a private family record">
          <div className="preview-topline">
            <span>Family record</span>
            <span className="private-pill">Private</span>
          </div>
          <div className="preview-person preview-person-featured">
            <div className="portrait portrait-rose" aria-hidden="true">EE</div>
            <div><strong>Example Elder</strong><span>3 stories · 8 photos</span></div>
          </div>
          <div className="relationship-thread" aria-hidden="true">
            <span className="thread-solid" />
            <small>documented parent</small>
          </div>
          <div className="preview-row">
            <div className="preview-person">
              <div className="portrait portrait-gold" aria-hidden="true">EP</div>
              <div><strong>Example Parent</strong><span>5 stories</span></div>
            </div>
            <div className="preview-person">
              <div className="portrait portrait-sage" aria-hidden="true">EC</div>
              <div><strong>Example Child</strong><span>2 voice notes</span></div>
            </div>
          </div>
          <div className="memory-note">
            <span className="memory-date">1987</span>
            <p>“Synthetic example: a Sunday memory about baking bread together.”</p>
          </div>
        </div>
      </section>

      <section className="principles" aria-label="Product principles">
        <article><span aria-hidden="true">01</span><h2>Your family decides</h2><p>Share one person or a branch—never the whole record by accident.</p></article>
        <article><span aria-hidden="true">02</span><h2>Every bond belongs</h2><p>Keep documented relationships and family knowledge distinct and visible.</p></article>
        <article><span aria-hidden="true">03</span><h2>People are not posts</h2><p>No follower counts, engagement scores, public discovery, or advertising.</p></article>
      </section>
    </main>
  );
}
