export type FamilyViewer = {
  id: string;
  displayName?: string | null;
  email?: string | null;
};

export type FamilyPerson = {
  id: string;
  displayName: string;
  birthDate?: string | null;
  birthDateAccuracy?: "unknown" | "exact" | "approximate" | null;
};

export type FamilyRelationship = {
  id: string;
  sourcePersonId: string;
  targetPersonId: string;
  relationshipType?: string | null;
  evidenceMode?: string | null;
  createdAt?: string | null;
  endedAt?: string | null;
};

export type FamilyStory = {
  id: string;
  personId: string;
  body: string;
  createdAt?: string | null;
};

export type FamilyMedia = {
  id: string;
  personId: string;
  kind?: string | null;
  fileName?: string | null;
  caption?: string | null;
  status?: string | null;
  accessUrl?: string | null;
  createdAt?: string | null;
};

export type FamilyShare = {
  id: string;
  recipientEmail?: string | null;
  permission?: string | null;
  revokedAt?: string | null;
};

export type FamilyDashboardData = {
  familyId: string;
  familyName: string;
  spaces: { id: string; name: string }[];
  access: { canCreatePeople: boolean; managedPersonIds: string[] };
  people: FamilyPerson[];
  relationships: FamilyRelationship[];
  stories: FamilyStory[];
  media: FamilyMedia[];
  shares: FamilyShare[];
};

export function withCreatedPerson(
  current: FamilyDashboardData,
  created: FamilyPerson,
): FamilyDashboardData {
  const alreadyManaged = current.access.managedPersonIds.includes(created.id);
  return {
    ...current,
    people: [...current.people, created],
    access: {
      ...current.access,
      managedPersonIds: alreadyManaged
        ? current.access.managedPersonIds
        : [...current.access.managedPersonIds, created.id],
    },
  };
}

export function withRenamedPerson(
  current: FamilyDashboardData,
  personId: string,
  displayName: string,
): FamilyDashboardData {
  return {
    ...current,
    people: current.people.map((person) =>
      person.id === personId ? { ...person, displayName } : person,
    ),
  };
}

export function withUnlinkedRelationship(
  current: FamilyDashboardData,
  relationshipId: string,
  endedAt: string,
): FamilyDashboardData {
  return {
    ...current,
    relationships: current.relationships.map((bond) =>
      bond.id === relationshipId ? { ...bond, endedAt } : bond,
    ),
  };
}

export function withRevokedShare(
  current: FamilyDashboardData,
  shareId: string,
  revokedAt: string,
): FamilyDashboardData {
  return {
    ...current,
    shares: current.shares.map((share) =>
      share.id === shareId ? { ...share, revokedAt } : share,
    ),
  };
}
