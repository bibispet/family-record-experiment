"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import {
  withCreatedPerson,
  withRenamedPerson,
  withRevokedShare,
  withUnlinkedRelationship,
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
    const displayName = String(new FormData(event.currentTarget).get("displayName") ?? "");
    void run(async () => {
      const result = await api<{ person: { id: string; displayName: string } }>(`/api/people/${personId}`, data.familyId, {
        method: "PATCH",
        body: JSON.stringify({ displayName }),
      });
      setData((current) => withRenamedPerson(current, result.person.id, result.person.displayName));
      setEditingPersonId(null);
      return `${result.person.displayName} was updated. The person was not deleted.`;
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
          <h1>{data.familyName}</h1>
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
              <ul className="people-list">
                {data.people.map((person) => (
                  <li key={person.id}>
                    <h4>{person.displayName}</h4>
                    <p>
                      {data.access.managedPersonIds.includes(person.id) ? "You can manage this record." : "View only."}
                      {person.birthDate ? ` Born ${person.birthDate}.` : ""}
                    </p>
                    {data.access.managedPersonIds.includes(person.id) && editingPersonId !== person.id ? (
                      <button className="edit-person-button text-button" type="button" disabled={busy} onClick={() => setEditingPersonId(person.id)}>
                        Rename
                      </button>
                    ) : null}
                    {editingPersonId === person.id ? (
                      <form className="people-edit-form" onSubmit={(event) => onRenamePerson(event, person.id)}>
                        <label>
                          Name
                          <input name="displayName" type="text" maxLength={120} defaultValue={person.displayName} required disabled={busy} />
                        </label>
                        <div className="form-actions">
                          <button className="button button-primary" type="submit" disabled={busy}>Save name</button>
                          <button className="text-button" type="button" onClick={() => setEditingPersonId(null)}>Cancel</button>
                        </div>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
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
              {data.stories.map((story) => (
                <article key={story.id}>
                  <p className="memory-kind">Story · {personName(data.people, story.personId)}</p>
                  <p>{story.body}</p>
                </article>
              ))}
              {data.media.map((item) => (
                <article key={item.id}>
                  <p className="memory-kind">{item.kind === "voice_note" ? "Voice" : "Photo"} · {personName(data.people, item.personId)}</p>
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
                </article>
              ))}
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
    </main>
  );
}
