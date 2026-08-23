import type { Metadata } from "next";
import { requireChatGPTUser } from "../chatgpt-auth";
import FamilyDashboard, { type FamilyDashboardData, type FamilyViewer } from "./FamilyDashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Family record",
  description: "Your private family people, relationships, photos, and stories.",
  robots: { index: false, follow: false },
};

export default async function FamilyPage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string | string[] }>;
}) {
  const signedIn = await requireChatGPTUser("/family");
  const { getFamilySnapshot } = await import("../lib/family-store");
  const requested = (await searchParams).space;
  const snapshot = await getFamilySnapshot({
    authSubject: signedIn.userId,
    email: signedIn.email.toLowerCase(),
    displayName: signedIn.displayName,
  }, typeof requested === "string" ? requested : undefined);

  return (
    <FamilyDashboard
      viewer={snapshot.viewer as FamilyViewer}
      initialData={snapshot.data as unknown as FamilyDashboardData}
    />
  );
}
