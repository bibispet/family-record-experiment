"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import {
  withCreatedPerson,
  withUpdatedPerson,
  withUpdatedStory,
  withDeletedStory,
  withUpdatedMedia,
  withDeletedMedia,
  withUpdatedFamilyName,
  withUpdatedRelationship,
  withRevokedShare,
  withUnlinkedRelationship,
  filterPeople,
  type FamilyDashboardData,
  type FamilyMedia,
  type FamilyPerson,
  type FamilyRelationship,
  type FamilyShare,
  type FamilyStory,
  type FamilyViewer,
} from "./family-dashboard-state";

export type {
  FamilyDashboardData,
  FamilyMedia,
  FamilyPerson,
  FamilyRelationship,
  FamilyShare,
  FamilyStory,
  FamilyViewer,
};
export { withCreatedPerson };

const RELATIONSHIP_LABELS: Record<string, string> = {
  parent_of: "Parent of",
  spouse_of: "Spouse of",
  sibling_of: "Sibling of",
  godparent_of: "Godparent of",
  close_family_friend_of: "Close family friend of",
  other: "Other bond",
};

type Feedback = { kind: "pending" | "success" | "error"; text: string } | null;

async function api<T>(
  path: string,
  spaceId: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-family-space-id", spaceId);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "That request could not be completed.");
  }
  return payload as T;
}

function personName(people: FamilyPerson[], id: string) {
  return people.find((person) => person.id === id)?.displayName ?? "Someone you can see";
}

function computeAge(birthDate: string | null): string | null {
  if (!birthDate) return null;
  try {
    const birth = new Date(birthDate + "T00:00:00Z");
    const now = new Date();
    let age = now.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
      age--;
    }
    return age >= 0 ? String(age) : null;
  } catch {
    return null;
  }
}

export default function FamilyDashboard({
  viewer,
  initialData,
}: {
  viewer: FamilyViewer;
  initialData: FamilyDashboardData;
}) {
  const [data, setData] = useState(initialData);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [selectedShareIds, setSelectedShareIds] = useState<string[]>([]);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [pendingUnlinkId, setPendingUnlinkId] = useState<string | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [personSearch, setPersonSearch] = useState("");
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [deletingStoryId, setDeletingStoryId] = useState<string | null>(null);
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);
  const [expandedPersonId, setExpandedPersonId] = useState<string | null>(null);
  const [editingRelationshipId, setEditingRelationshipId] = useState<string | null>(null);
  const [editingFamilyName, setEditingFamilyName] = useState(false);
  const [auditEvents, setAuditEvents] = useState<{ id: string; action: string; resourceType: string; resourceId: string; occurredAt: string; actorEmail: string | null }[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const managedPeople = useMemo(
    () => data.people.filter((person) => data.access.managedPersonIds.includes(person.id)),
    [data],
  );
  const who = viewer.displayName || viewer.email || "Signed-in family member";

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setFeedback({ kind: "pending", text: "Saving…" });
    try {
      const text = await action();
      setFeedback({ kind: "success", text });
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  function onCreatePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const displayName = String(new FormData(form).get("displayName") ?? "");
    const birthDate = String(new FormData(form).get("birthDate") ?? "") || null;
    void run(async () => {
      const result = await api<{ person: FamilyPerson }>("/api/people", data.familyId, {
        method: "POST",
        body: JSON.stringify({ displayName, birthDate }),
      });
      setData((current) => withCreatedPerson(current, result.person));
      form.reset();
      return `${result.person.displayName} is now in this private record.`;
    });
  }

  function onCreateStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const personId = String(fields.get("personId") ?? "");
    const body = String(fields.get("body") ?? "");
    void run(async () => {
      const result = await api<{ story: FamilyStory }>(`/api/people/${personId}/stories`, data.familyId, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setData((current) => ({ ...current, stories: [result.story, ...current.stories] }));
      form.reset();
      return "Story saved to the person you manage.";
    });
  }

  function onEditStory(event: FormEvent<HTMLFormElement>, storyId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "");
    void run(async () => {
      const result = await api<{ story: FamilyStory }>(`/api/stories/${storyId}`, data.familyId, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      setData((current) => withUpdatedStory(current, storyId, result.story.body));
      setEditingStoryId(null);
      return "Story updated.";
    });
  }

  function onDeleteStory(storyId: string) {
    void run(async () => {
      await api<{ id: string }>(`/api/stories/${storyId}`, data.familyId, { method: "DELETE" });
      setData((current) => withDeletedStory(current, storyId));
      setDeletingStoryId(null);
      return "Story removed from the record.";
    });
  }

  function onEditMediaCaption(event: FormEvent<HTMLFormElement>, mediaId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const caption = String(new FormData(form).get("caption") ?? "") || null;
    void run(async () => {
      const result = await api<{ media: FamilyMedia }>(`/api/media/${mediaId}`, data.familyId, {
        method: "PATCH",
        body: JSON.stringify({ caption }),
      });
      setData((current) => withUpdatedMedia(current, mediaId, result.media.caption ?? null));
      setEditingMediaId(null);
      return "Caption updated.";
    });
  }

  function onDeleteMedia(mediaId: string) {
    void run(async () => {
      await api<{ id: string }>(`/api/media/${mediaId}`, data.familyId, { method: "DELETE" });
      setData((current) => withDeletedMedia(current, mediaId));
      setDeletingMediaId(null);
      return "Media removed from the record.";
    });
  }

  function onEditRelationship(event: FormEvent<HTMLFormElement>, relationshipId: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void run(async () => {
      const body: Record<string, string> = {};
      const rt = fields.get("relationshipType");
      const em = fields.get("evidenceMode");
      if (rt) body.relationshipType = String(rt);
      if (em) body.evidenceMode = String(em);
      const result = await api<{ relationship: FamilyRelationship }>(`/api/relationships/${relationshipId}`, data.familyId, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setData((current) => withUpdatedRelationship(current, relationshipId, result.relationship.relationshipType ?? "", result.relationship.evidenceMode ?? ""));
      setEditingRelationshipId(null);
      return "Relationship updated.";
    });
  }

  async function fetchAudit() {
    if (auditEvents !== null) { setAuditEvents(null); return; }
    setAuditLoading(true);
    try {
      const result = await api<{ events: typeof auditEvents }>(`/api/audit`, data.familyId);
      setAuditEvents(result.events ?? []);
    } catch {
      setAuditEvents([]);
    } finally {
      setAuditLoading(false);
    }
  }

  function onCreateRelationship(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void run(async () => {
      const result = await api<{ relationship: FamilyRelationship }>("/api/relationships", data.familyId, {
        method: "POST",
        body: JSON.stringify({
          sourcePersonId: fields.get("sourcePersonId"),
          targetPersonId: fields.get("targetPersonId"),
          relationshipType: fields.get("relationshipType"),
          evidenceMode: fields.get("evidenceMode"),
        }),
      });
      setData((current) => ({ ...current, relationships: [result.relationship, ...current.relationships] }));
      form.reset();
      return "Relationship recorded. It grants no access by itself.";
    });
  }

  function onCreateShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const recipientEmail = String(new FormData(form).get("recipientEmail") ?? "");
    void run(async () => {
      const result = await api<{ share: FamilyShare }>("/api/shares", data.familyId, {
        method: "POST",
        body: JSON.stringify({ recipientEmail, personIds: selectedShareIds }),
      });
      setData((current) => ({ ...current, shares: [result.share, ...current.shares] }));
      form.reset();
      setSelectedShareIds([]);
      return "View-only share created. New people will not be added to it later.";
    });
  }

  function onRenameFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("familyName") ?? "").trim();
    if (!name) return;
    void run(async () => {
      const result = await api<{ space: { id: string; name: string } }>("/api/family", data.familyId, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setData((current) => withUpdatedFamilyName(current, result.space.name));
      setEditingFamilyName(false);
      return `Family renamed to ${result.space.name}.`;
    });
  }

  function onUploadMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const personId = String(fields.get("personId") ?? "");
    void run(async () => {
      const result = await api<{ media: FamilyMedia }>(`/api/people/${personId}/media`, data.familyId, {
        method: "POST",
        body: fields,
      });
      setData((current) => ({ ...current, media: [result.media, ...current.media] }));
      form.reset();
      return "Media stored privately. The file key never leaves the server.";
    });
  }

  function onRenamePerson(event: FormEvent<HTMLFormElement>, personId: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const displayName = String(fields.get("displayName") ?? "");
    const birthDate = String(fields.get("birthDate") ?? "") || null;
    void run(async () => {
      const result = await api<{ person: FamilyPerson }>(`/api/people/${personId}`, data.familyId, {
        method: "PATCH",
        body: JSON.stringify({ displayName, birthDate }),
      });
      setData((current) => withUpdatedPerson(current, personId, result.person.displayName, result.person.birthDate ?? null, result.person.birthDateAccuracy ?? "unknown"));
      setEditingPersonId(null);
      return `Record updated for ${result.person.displayName}.`;
    });
  }

  function onUnlinkRelationship(relationshipId: string) {
    void run(async () => {
      const result = await api<{ relationship: FamilyRelationship }>(`/api/relationships/${relationshipId}/unlink`, data.familyId, {
        method: "POST",
      });
      setData((current) => withUnlinkedRelationship(current, result.relationship.id, result.relationship.endedAt ?? new Date().toISOString()));
      setPendingUnlinkId(null);
      return "Bond ended. Both people and the historical row remain.";
    });
  }

  function onRevokeShare(shareId: string) {
    void run(async () => {
      const result = await api<{ share: FamilyShare }>(`/api/shares/${shareId}/revoke`, data.familyId, {
        method: "POST",
      });
      setData((current) => withRevokedShare(current, result.share.id, result.share.revokedAt ?? new Date().toISOString()));
      setPendingRevokeId(null);
      return "Share revoked. It stays on the record as history.";
    });
  }

  return (
    <main className="family-dashboard">
      <a className="skip-link" href="#people">Skip to people</a>
      <header className="family-dashboard-header">
        <div>
          <p className="eyebrow">Private family record</p>
          {editingFamilyName ? (
            <form className="inline-edit" onSubmit={onRenameFamily} style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
              <input name="familyName" type="text" defaultValue={data.familyName} maxLength={200} required disabled={busy} />
              <button className="button button-primary" type="submit" disabled={busy}>Save</button>
              <button className="button" type="button" disabled={busy} onClick={() => setEditingFamilyName(false)}>Cancel</button>
            </form>
          ) : (
            <button className="text-button" type="button" disabled={busy} onClick={() => setEditingFamilyName(true)} style={{ fontSize: "inherit", fontFamily: "inherit", fontWeight: "inherit", padding: 0, lineHeight: "inherit" }}>{data.familyName}</button>
          )}
          <p>Viewing as {who}. There is no feed, no public discovery, and no advertising here.</p>
          {data.spaces.length > 1 ? (
            <label className="space-picker">
              Family space
              <select
                defaultValue={data.familyId}
                onChange={(event) => {
                  const next = event.target.value;
                  window.location.assign(`/family?space=${encodeURIComponent(next)}`);
                }}
              >
                {data.spaces.map((space) => (
                  <option key={space.id} value={space.id}>{space.name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <aside className="privacy-callout">
          <strong>Shares stay snapshots.</strong> Adding a person later does not widen an existing grant. Relationships never confer authority.
          <p className="prototype-boundary">Age-18 transfer is policy-blocked. A human has to decide that; the app will not do it automatically.</p>
        </aside>
      </header>

      <nav className="dashboard-jump-links" aria-label="Record sections">
        <a href="#people">People</a>
        <a href="#bonds">Bonds</a>
        <a href="#memories">Stories &amp; media</a>
        <a href="#shares">Shares</a>
        <Link href="/family/graph">Graph</Link>
        <Link href="/">Home</Link>
      </nav>

      {feedback ? <p className={`form-feedback form-feedback-${feedback.kind}`} role="status">{feedback.text}</p> : null}

      <section id="people" className="dashboard-section">
        <div className="section-heading">
          <p className="step-label">01</p>
          <h2>People</h2>
          <p>A name is enough. A family role does not make anyone omniscient.</p>
        </div>
        <div className="dashboard-grid">
          {data.access.canCreatePeople ? (
            <form className="dashboard-card capture-card" onSubmit={onCreatePerson}>
              <h3>Add a person</h3>
              <label>
                Name
                <input name="displayName" type="text" maxLength={120} required disabled={busy} />
              </label>
              <label>
                Date of birth <span className="field-help">Optional. Exact calendar date only.</span>
                <input name="birthDate" type="date" disabled={busy} />
              </label>
              <button className="button button-primary" type="submit" disabled={busy}>Save person</button>
            </form>
          ) : (
            <div className="dashboard-card">
              <h3>Add a person</h3>
              <p className="empty-state">Only a space steward can create people here.</p>
            </div>
          )}
          <div className="dashboard-card">
            <h3>Visible in this space</h3>
            {data.people.length === 0 ? (
              <p className="empty-state">No people are visible to you yet.</p>
            ) : (
              <>
                <label className="person-search-label">
                  Search
                  <input
                    type="search"
                    placeholder="Filter by name…"
                    value={personSearch}
                    onChange={(event) => setPersonSearch(event.target.value)}
                  />
                </label>
                {(() => {
                  const filtered = filterPeople(data.people, personSearch);
                  if (filtered.length === 0) {
                    return <p className="empty-state">No people match your search.</p>;
                  }
                  return (
                    <ul className="people-list">
                      {filtered.map((person) => (
                  <li key={person.id}>
                    <h4>{person.displayName}</h4>
                    <p>
                      {data.access.managedPersonIds.includes(person.id) ? "You can manage this record." : "View only."}
                      {person.birthDate ? ` Born ${person.birthDate}.` : ""}
                      {(() => { const age = computeAge(person.birthDate ?? null); return age !== null ? ` Age ${age}.` : null; })()}
                    </p>
                    <button className="text-button" type="button" disabled={busy} onClick={() => setExpandedPersonId(expandedPersonId === person.id ? null : person.id)}>
                      {expandedPersonId === person.id ? "Hide details" : "Show details"}
                    </button>
                    {expandedPersonId === person.id ? (
                      <div className="person-detail" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border-color, #ddd)" }}>
                        {data.stories.filter((s) => s.personId === person.id).length + data.media.filter((m) => m.personId === person.id).length === 0 ? (
                          <p className="empty-state">No stories or media for this person yet.</p>
                        ) : (
                          <>
                            {data.stories.filter((s) => s.personId === person.id).map((story) => (
                              <article key={story.id} style={{ marginBottom: "0.5rem" }}>
                                <p className="memory-kind">Story</p>
                                <p>{story.body}</p>
                              </article>
                            ))}
                            {data.media.filter((m) => m.personId === person.id).map((item) => (
                              <article key={item.id} style={{ marginBottom: "0.5rem" }}>
                                <p className="memory-kind">{item.kind === "voice_note" ? "Voice" : "Photo"}</p>
                                <p>{item.caption || item.fileName || "Private media"}</p>
                                {item.accessUrl && item.kind === "photo" ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={item.accessUrl} alt={item.caption || ""} style={{ maxWidth: "200px" }} />
                                ) : null}
                                {item.accessUrl && item.kind === "voice_note" ? (
                                  <audio controls src={item.accessUrl}>
                                    <track kind="captions" srcLang="en" label="Captions" />
                                  </audio>
                                ) : null}
                              </article>
                            ))}
                          </>
                        )}
                      </div>
                    ) : null}
                    {data.access.managedPersonIds.includes(person.id) && editingPersonId !== person.id ? (
                      <button className="edit-person-button text-button" type="button" disabled={busy} onClick={() => setEditingPersonId(person.id)}>
                        Edit
                      </button>
                    ) : null}
                    {editingPersonId === person.id ? (
                      <form className="people-edit-form" onSubmit={(event) => onRenamePerson(event, person.id)}>
                        <label>
                          Name
                          <input name="displayName" type="text" maxLength={120} defaultValue={person.displayName} required disabled={busy} />
                        </label>
                        <label>
                          Date of birth <span className="field-help">Optional. Exact calendar date only.</span>
                          <input name="birthDate" type="date" defaultValue={person.birthDate ?? ""} disabled={busy} />
                        </label>
                        <div className="form-actions">
                          <button className="button button-primary" type="submit" disabled={busy}>Save changes</button>
                          <button className="text-button" type="button" onClick={() => setEditingPersonId(null)}>Cancel</button>
                        </div>
                      </form>
                    ) : null}
                  </li>
                ))}
                    </ul>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </section>

      <section id="bonds" className="dashboard-section">
        <div className="section-heading">
          <p className="step-label">02</p>
          <h2>Bonds</h2>
          <p>Documented and oral knowledge stay distinct. A bond is never a permission.</p>
        </div>
        <div className="dashboard-grid">
          <form className="dashboard-card capture-card" onSubmit={onCreateRelationship}>
            <h3>Record a relationship</h3>
            <label>
              First person
              <select name="sourcePersonId" required disabled={busy || managedPeople.length < 2}>
                {managedPeople.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
              </select>
            </label>
            <label>
              Second person
              <select name="targetPersonId" required disabled={busy || managedPeople.length < 2}>
                {managedPeople.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
              </select>
            </label>
            <label>
              Kind
              <select name="relationshipType" required disabled={busy}>
                {Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>How you know</legend>
              <label className="radio-card">
                <input type="radio" name="evidenceMode" value="verified" defaultChecked />
                <span>Documented<small>A record you can point to.</small></span>
              </label>
              <label className="radio-card">
                <input type="radio" name="evidenceMode" value="oral" />
                <span>Oral family knowledge<small>Kept, but not treated as a certificate.</small></span>
              </label>
            </fieldset>
            <button className="button button-primary" type="submit" disabled={busy || managedPeople.length < 2}>Save bond</button>
          </form>
          <div className="dashboard-card">
            <h3>Recorded relationships</h3>
            {data.relationships.length === 0 ? (
              <p className="empty-state">No bonds are visible yet.</p>
            ) : (
              <ul className="relationship-list">
                {data.relationships.map((bond) => {
                  const canUnlink = !bond.endedAt
                    && data.access.managedPersonIds.includes(bond.sourcePersonId)
                    && data.access.managedPersonIds.includes(bond.targetPersonId);
                  return (
                  <li key={bond.id}>
                    <p>
                      {personName(data.people, bond.sourcePersonId)}
                      {" · "}
                      {RELATIONSHIP_LABELS[bond.relationshipType ?? ""] ?? bond.relationshipType}
                      {" · "}
                      {personName(data.people, bond.targetPersonId)}
                    </p>
                    <span className="relationship-mode">
                      {bond.endedAt ? "Ended" : bond.evidenceMode === "oral" ? "Oral" : "Documented"}
                    </span>
                    {canUnlink && !bond.endedAt && editingRelationshipId !== bond.id ? (
                      <button className="edit-person-button text-button" type="button" disabled={busy} onClick={() => setEditingRelationshipId(bond.id)}>
                        Edit
                      </button>
                    ) : null}
                    {editingRelationshipId === bond.id ? (
                      <form className="people-edit-form" onSubmit={(event) => onEditRelationship(event, bond.id)}>
                        <label>
                          Kind
                          <select name="relationshipType" defaultValue={bond.relationshipType ?? ""} disabled={busy}>
                            {Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          How you know
                          <select name="evidenceMode" defaultValue={bond.evidenceMode ?? ""} disabled={busy}>
                            <option value="verified">Documented</option>
                            <option value="oral">Oral family knowledge</option>
                          </select>
                        </label>
                        <div className="form-actions">
                          <button className="button button-primary" type="submit" disabled={busy}>Save</button>
                          <button className="text-button" type="button" onClick={() => setEditingRelationshipId(null)}>Cancel</button>
                        </div>
                      </form>
                    ) : null}
                    {canUnlink && pendingUnlinkId !== bond.id ? (
                      <button className="edit-person-button text-button" type="button" disabled={busy} onClick={() => setPendingUnlinkId(bond.id)}>
                        End this bond
                      </button>
                    ) : null}
                    {pendingUnlinkId === bond.id ? (
                      <div className="inline-confirmation">
                        <p>This ends the relationship. Both people stay. The history stays.</p>
                        <button type="button" disabled={busy} onClick={() => onUnlinkRelationship(bond.id)}>End bond</button>
                        <button type="button" onClick={() => setPendingUnlinkId(null)}>Keep it</button>
                      </div>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section id="memories" className="dashboard-section">
        <div className="section-heading">
          <p className="step-label">03</p>
          <h2>Stories and media</h2>
          <p>Stories inherit the owning person. Files are served only after a fresh authorization check.</p>
        </div>
        <div className="dashboard-grid">
          <form className="dashboard-card capture-card" onSubmit={onCreateStory}>
            <h3>Add a story</h3>
            <label>
              About
              <select name="personId" required disabled={busy || managedPeople.length === 0}>
                {managedPeople.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
              </select>
            </label>
            <label>
              Story
              <textarea name="body" maxLength={4000} required disabled={busy} />
            </label>
            <button className="button button-primary" type="submit" disabled={busy || managedPeople.length === 0}>Save story</button>
          </form>
          <form className="dashboard-card capture-card" onSubmit={onUploadMedia}>
            <h3>Add a photo or voice note</h3>
            <label>
              About
              <select name="personId" required disabled={busy || managedPeople.length === 0}>
                {managedPeople.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
              </select>
            </label>
            <label>
              Kind
              <select name="kind" required disabled={busy}>
                <option value="photo">Photo</option>
                <option value="voice_note">Voice note</option>
              </select>
            </label>
            <label>
              File
              <input name="file" type="file" required disabled={busy} />
            </label>
            <label>
              Caption
              <input name="caption" type="text" maxLength={300} disabled={busy} />
            </label>
            <button className="button button-primary" type="submit" disabled={busy || managedPeople.length === 0}>Store privately</button>
          </form>
        </div>
        <div className="dashboard-card memory-list-card">
          <h3>Visible memories</h3>
          {data.stories.length + data.media.length === 0 ? (
            <p className="empty-state">No stories or media are visible yet.</p>
          ) : (
            <div className="memory-list">
              {data.stories.map((story) => {
                const canManage = data.access.managedPersonIds.includes(story.personId);
                return (
                <article key={story.id}>
                  <p className="memory-kind">Story · {personName(data.people, story.personId)}</p>
                  {editingStoryId === story.id ? (
                    <form className="people-edit-form" onSubmit={(event) => onEditStory(event, story.id)}>
                      <label>
                        Story
                        <textarea name="body" maxLength={4000} defaultValue={story.body} required disabled={busy} />
                      </label>
                      <div className="form-actions">
                        <button className="button button-primary" type="submit" disabled={busy}>Save</button>
                        <button className="text-button" type="button" onClick={() => setEditingStoryId(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p>{story.body}</p>
                      {canManage && deletingStoryId !== story.id ? (
                        <div className="form-actions">
                          <button className="text-button" type="button" disabled={busy} onClick={() => setEditingStoryId(story.id)}>Edit</button>
                          <button className="text-button" type="button" disabled={busy} onClick={() => setDeletingStoryId(story.id)}>Delete</button>
                        </div>
                      ) : null}
                      {deletingStoryId === story.id ? (
                        <div className="inline-confirmation">
                          <p>This removes the story from the record. This cannot be undone.</p>
                          <button type="button" disabled={busy} onClick={() => onDeleteStory(story.id)}>Delete story</button>
                          <button type="button" onClick={() => setDeletingStoryId(null)}>Keep it</button>
                        </div>
                      ) : null}
                    </>
                  )}
                </article>
                );
              })}
              {data.media.map((item) => {
                const canManage = data.access.managedPersonIds.includes(item.personId);
                return (
                <article key={item.id}>
                  <p className="memory-kind">{item.kind === "voice_note" ? "Voice" : "Photo"} · {personName(data.people, item.personId)}</p>
                  {editingMediaId === item.id ? (
                    <form className="people-edit-form" onSubmit={(event) => onEditMediaCaption(event, item.id)}>
                      <label>
                        Caption
                        <input name="caption" type="text" maxLength={300} defaultValue={item.caption ?? ""} disabled={busy} />
                      </label>
                      <div className="form-actions">
                        <button className="button button-primary" type="submit" disabled={busy}>Save</button>
                        <button className="text-button" type="button" onClick={() => setEditingMediaId(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p>{item.caption || item.fileName || "Private media"}</p>
                      {item.accessUrl && item.kind === "photo" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.accessUrl} alt={item.caption || ""} />
                      ) : null}
                      {item.accessUrl && item.kind === "voice_note" ? (
                        <audio controls src={item.accessUrl}>
                          <track kind="captions" srcLang="en" label="Captions" />
                        </audio>
                      ) : null}
                      {canManage && deletingMediaId !== item.id ? (
                        <div className="form-actions">
                          <button className="text-button" type="button" disabled={busy} onClick={() => setEditingMediaId(item.id)}>Edit caption</button>
                          <button className="text-button" type="button" disabled={busy} onClick={() => setDeletingMediaId(item.id)}>Delete</button>
                        </div>
                      ) : null}
                      {deletingMediaId === item.id ? (
                        <div className="inline-confirmation">
                          <p>This removes the media file and caption. This cannot be undone.</p>
                          <button type="button" disabled={busy} onClick={() => onDeleteMedia(item.id)}>Delete media</button>
                          <button type="button" onClick={() => setDeletingMediaId(null)}>Keep it</button>
                        </div>
                      ) : null}
                    </>
                  )}
                </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section id="shares" className="dashboard-section">
        <div className="section-heading">
          <p className="step-label">04</p>
          <h2>Reviewed shares</h2>
          <p>View only. The recipient must already have signed in. Graph changes will not widen this set.</p>
        </div>
        <div className="dashboard-grid">
          <form className="dashboard-card capture-card" onSubmit={onCreateShare}>
            <h3>Share selected people</h3>
            <label>
              Recipient email
              <input name="recipientEmail" type="email" required disabled={busy} />
            </label>
            <fieldset>
              <legend>People to include</legend>
              {managedPeople.length === 0 ? (
                <p className="empty-state">Manage at least one person first.</p>
              ) : managedPeople.map((person) => (
                <label key={person.id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedShareIds.includes(person.id)}
                    onChange={(event) => {
                      setSelectedShareIds((current) =>
                        event.target.checked
                          ? [...current, person.id]
                          : current.filter((id) => id !== person.id),
                      );
                    }}
                  />
                  {person.displayName}
                </label>
              ))}
            </fieldset>
            <button className="button button-primary" type="submit" disabled={busy || selectedShareIds.length === 0}>
              Create view-only share
            </button>
          </form>
          <div className="dashboard-card">
            <h3>Shares you created</h3>
            {data.shares.length === 0 ? (
              <p className="empty-state">You have not created a share in this space.</p>
            ) : (
              <ul className="share-list">
                {data.shares.map((share) => (
                  <li key={share.id}>
                    <p>{share.recipientEmail ?? "Signed-in family member"}</p>
                    <span className="relationship-mode">{share.revokedAt ? "Revoked" : share.permission ?? "view"}</span>
                    {!share.revokedAt && pendingRevokeId !== share.id ? (
                      <button className="edit-person-button text-button" type="button" disabled={busy} onClick={() => setPendingRevokeId(share.id)}>
                        Revoke
                      </button>
                    ) : null}
                    {pendingRevokeId === share.id ? (
                      <div className="inline-confirmation">
                        <p>They will lose view access. The share remains as history. People are not deleted.</p>
                        <button type="button" disabled={busy} onClick={() => onRevokeShare(share.id)}>Revoke share</button>
                        <button type="button" onClick={() => setPendingRevokeId(null)}>Keep it</button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section id="audit" className="dashboard-section">
        <div className="section-heading">
          <p className="step-label">05</p>
          <h2>Audit trail</h2>
          <p>Every mutation is recorded. Nothing is silently changed.</p>
        </div>
        <div className="dashboard-card">
          <button className="text-button" type="button" disabled={busy || auditLoading} onClick={fetchAudit}>
            {auditEvents === null ? "Show recent activity" : "Hide activity"}
          </button>
          {auditLoading ? <p className="empty-state">Loading...</p> : null}
          {auditEvents !== null && !auditLoading ? (
            auditEvents.length === 0 ? (
              <p className="empty-state">No recorded activity yet.</p>
            ) : (
              <ul className="share-list">
                {auditEvents.map((event) => (
                  <li key={event.id}>
                    <p><strong>{event.action}</strong> on {event.resourceType}</p>
                    <span className="relationship-mode">{new Date(event.occurredAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </section>
    </main>
  );
}
