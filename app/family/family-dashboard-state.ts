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

export function withUpdatedPerson(
  current: FamilyDashboardData,
  personId: string,
  displayName: string,
  birthDate: string | null,
  birthDateAccuracy: "unknown" | "exact" | "approximate",
): FamilyDashboardData {
  return {
    ...current,
    people: current.people.map((person) =>
      person.id === personId ? { ...person, displayName, birthDate, birthDateAccuracy } : person,
    ),
  };
}

export function withUpdatedStory(
  current: FamilyDashboardData,
  storyId: string,
  body: string,
): FamilyDashboardData {
  return {
    ...current,
    stories: current.stories.map((story) =>
      story.id === storyId ? { ...story, body } : story,
    ),
  };
}

export function withDeletedStory(
  current: FamilyDashboardData,
  storyId: string,
): FamilyDashboardData {
  return {
    ...current,
    stories: current.stories.filter((story) => story.id !== storyId),
  };
}

export function withUpdatedMedia(
  current: FamilyDashboardData,
  mediaId: string,
  caption: string | null,
): FamilyDashboardData {
  return {
    ...current,
    media: current.media.map((item) =>
      item.id === mediaId ? { ...item, caption } : item,
    ),
  };
}

export function withDeletedMedia(
  current: FamilyDashboardData,
  mediaId: string,
): FamilyDashboardData {
  return {
    ...current,
    media: current.media.filter((item) => item.id !== mediaId),
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

export function withUpdatedRelationship(
  current: FamilyDashboardData,
  relationshipId: string,
  relationshipType: string,
  evidenceMode: string,
): FamilyDashboardData {
  return {
    ...current,
    relationships: current.relationships.map((bond) =>
      bond.id === relationshipId ? { ...bond, relationshipType, evidenceMode } : bond,
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

export function withUpdatedFamilyName(
  current: FamilyDashboardData,
  familyName: string,
): FamilyDashboardData {
  return { ...current, familyName };
}

