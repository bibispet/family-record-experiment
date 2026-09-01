import type { Metadata } from "next";
import { requireRscViewer, viewerToApiActor } from "../../lib/identity";
import FamilyGraph from "./FamilyGraph";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Family graph",
  description: "Visual relationship graph for your private family record.",
  robots: { index: false, follow: false },
};

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string | string[] }>;
}) {
  const viewer = await requireRscViewer("/family/graph");
  const { getFamilySnapshot } = await import("../../lib/family-store");
  const requested = (await searchParams).space;
  const snapshot = await getFamilySnapshot(viewerToApiActor(viewer), typeof requested === "string" ? requested : undefined);

  return (
    <main className="family-dashboard">
      <nav className="dashboard-jump-links" aria-label="Navigation">
        <a href="/family">Dashboard</a>
        <a href={`/family${typeof requested === "string" ? `?space=${encodeURIComponent(requested)}` : ""}`}>Back to records</a>
      </nav>
      <FamilyGraph
        people={snapshot.data.people as { id: string; displayName: string; birthDate?: string | null }[]}
        relationships={snapshot.data.relationships as { id: string; sourcePersonId: string; targetPersonId: string; relationshipType?: string | null; evidenceMode?: string | null; endedAt?: string | null }[]}
      />
    </main>
  );
}
