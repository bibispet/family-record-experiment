import type { Metadata } from "next";
import { requireRscViewer, viewerToApiActor } from "../../lib/identity";
import FamilyGraph from "./FamilyGraph";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Family graph",
  description: "Interactive family relationship graph.",
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
  const snapshot = await getFamilySnapshot(
    viewerToApiActor(viewer),
    typeof requested === "string" ? requested : undefined,
  );

  return (
    <FamilyGraph
      viewer={{
        id: snapshot.viewer.id,
        displayName: snapshot.viewer.displayName,
        email: snapshot.viewer.email,
      }}
      people={snapshot.data.people}
      relationships={snapshot.data.relationships as { id: string; sourcePersonId: string; targetPersonId: string; relationshipType?: string | null; evidenceMode?: string | null; endedAt?: string | null }[]}
      familyId={snapshot.data.familyId}
      familyName={snapshot.data.familyName}
      spaces={snapshot.data.spaces}
    />
  );
}
