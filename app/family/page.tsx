import type { Metadata } from "next";
import { getDemoSnapshot } from "../lib/demo";
import FamilyDashboard, { type FamilyDashboardData, type FamilyViewer } from "./FamilyDashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Family record",
  description: "Your private family people, relationships, photos, and stories.",
  robots: { index: false, follow: false },
};

export default function FamilyPage() {
  const snapshot = getDemoSnapshot();

  return (
    <FamilyDashboard
      viewer={snapshot.viewer as FamilyViewer}
      initialData={snapshot.data as unknown as FamilyDashboardData}
      demoMode
    />
  );
}
