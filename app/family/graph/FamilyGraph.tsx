"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useGraphLayout, type GraphEdge, type GraphNode } from "./useGraphLayout";

const PORTRAIT_COLORS = ["#ba6b5a", "#d0a55b", "#7d9a83", "#234f43", "#8b6f47", "#6b7f5e"];

const RELATIONSHIP_LABELS: Record<string, string> = {
  parent_of: "Parent of",
  spouse_of: "Spouse of",
  sibling_of: "Sibling of",
  godparent_of: "Godparent of",
  close_family_friend_of: "Close family friend of",
  other: "Other bond",
};

const EDGE_DASH: Record<string, string | undefined> = {
  godparent_of: "6 4",
  close_family_friend_of: "2 3",
};

type Person = {
  id: string;
  displayName: string;
  birthDate?: string | null;
  birthDateAccuracy?: string | null;
};

type Relationship = {
  id: string;
  sourcePersonId: string;
  targetPersonId: string;
  relationshipType?: string | null;
  evidenceMode?: string | null;
  endedAt?: string | null;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function portraitColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return PORTRAIT_COLORS[Math.abs(hash) % PORTRAIT_COLORS.length];
}

export default function FamilyGraph({
  people,
  relationships,
  familyId,
  familyName,
  spaces,
}: {
  viewer: { id: string; displayName?: string | null; email?: string | null };
  people: Person[];
  relationships: Relationship[];
  familyId: string;
  familyName: string;
  spaces: { id: string; name: string }[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState({ x: -400, y: -300, w: 800, h: 600 });
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const graphNodes: GraphNode[] = useMemo(
    () => people.map((p) => ({ id: p.id, label: p.displayName, subtitle: p.birthDate })),
    [people],
  );

  const graphEdges: GraphEdge[] = useMemo(
    () =>
      relationships.map((r) => ({
        id: r.id,
        sourceId: r.sourcePersonId,
        targetId: r.targetPersonId,
        type: r.relationshipType ?? "other",
        ended: !!r.endedAt,
      })),
    [relationships],
  );

  const { positions, settled } = useGraphLayout(graphNodes, graphEdges);

  const posMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const p of positions) m.set(p.id, p);
    return m;
  }, [positions]);

  const connectedEdges = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    return new Set(
      graphEdges
        .filter((e) => e.sourceId === hoveredId || e.targetId === hoveredId)
        .map((e) => e.id),
    );
  }, [hoveredId, graphEdges]);

  const connectedNodes = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const s = new Set<string>([hoveredId]);
    for (const e of graphEdges) {
      if (e.sourceId === hoveredId) s.add(e.targetId);
      if (e.targetId === hoveredId) s.add(e.sourceId);
    }
    return s;
  }, [hoveredId, graphEdges]);

  const selectedPerson = useMemo(
    () => (selectedId ? people.find((p) => p.id === selectedId) ?? null : null),
    [selectedId, people],
  );

  const selectedRelationships = useMemo(() => {
    if (!selectedId) return [];
    return relationships.filter(
      (r) => r.sourcePersonId === selectedId || r.targetPersonId === selectedId,
    );
  }, [selectedId, relationships]);

  const personName = useCallback(
    (id: string) => people.find((p) => p.id === id)?.displayName ?? "Someone",
    [people],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as Element).closest(".graph-node")) return;
      setPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [viewBox],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!panning) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = viewBox.w / rect.width;
      const scaleY = viewBox.h / rect.height;
      const dx = (e.clientX - panStart.current.x) * scaleX;
      const dy = (e.clientY - panStart.current.y) * scaleY;
      setViewBox((v) => ({ ...v, x: panStart.current.vx - dx, y: panStart.current.vy - dy }));
    },
    [panning, viewBox.w, viewBox.h],
  );

  const onPointerUp = useCallback(() => {
    setPanning(false);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    setViewBox((v) => {
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      const nw = v.w * factor;
      const nh = v.h * factor;
      return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    });
  }, []);

  return (
    <main className="family-dashboard">
      <header className="family-dashboard-header">
        <div>
          <p className="eyebrow">Private family record</p>
          <h1>{familyName}</h1>
          <p>Graph view. Pan and scroll to explore. Click a person for details.</p>
          {spaces.length > 1 ? (
            <label className="space-picker">
              Family space
              <select
                defaultValue={familyId}
                onChange={(e) => {
                  window.location.assign(`/family/graph?space=${encodeURIComponent(e.target.value)}`);
                }}
              >
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </header>

      <nav className="dashboard-jump-links" aria-label="Record sections">
        <Link href="/family">Dashboard</Link>
        <Link href={`/family?space=${encodeURIComponent(familyId)}`}>List view</Link>
      </nav>

      <div className="graph-layout">
        <div className="graph-container">
          <svg
            ref={svgRef}
            className="graph-svg"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
          >
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--forest)" />
              </marker>
              <marker id="arrow-ended" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#aaa99f" />
              </marker>
            </defs>

            {graphEdges.map((edge) => {
              const a = posMap.get(edge.sourceId);
              const b = posMap.get(edge.targetId);
              if (!a || !b) return null;

              const isDimmed = hoveredId && !connectedEdges.has(edge.id);
              const isSpouse = edge.type === "spouse_of";
              const dash = EDGE_DASH[edge.type];
              const ended = edge.ended;

              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const nx = (dx / dist) * 28;
              const ny = (dy / dist) * 28;

              const strokeColor = ended ? "#aaa99f" : "var(--forest)";
              const strokeWidth = isSpouse ? 2.5 : 1.8;
              const opacity = isDimmed ? 0.15 : ended ? 0.5 : 0.8;
              const markerEnd = edge.type === "parent_of" ? (ended ? "url(#arrow-ended)" : "url(#arrow)") : undefined;

              if (isSpouse) {
                const perpX = (-dy / dist) * 4;
                const perpY = (dx / dist) * 4;
                return (
                  <g key={edge.id} opacity={opacity}>
                    <line
                      x1={a.x + nx + perpX} y1={a.y + ny + perpY}
                      x2={b.x - nx + perpX} y2={b.y - ny + perpY}
                      stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round"
                    />
                    <line
                      x1={a.x + nx - perpX} y1={a.y + ny - perpY}
                      x2={b.x - nx - perpX} y2={b.y - ny - perpY}
                      stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round"
                    />
                  </g>
                );
              }

              return (
                <line
                  key={edge.id}
                  x1={a.x + nx} y1={a.y + ny}
                  x2={b.x - nx} y2={b.y - ny}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dash}
                  strokeLinecap="round"
                  markerEnd={markerEnd}
                  opacity={opacity}
                />
              );
            })}

            {graphNodes.map((node) => {
              const pos = posMap.get(node.id);
              if (!pos) return null;

              const isSelected = selectedId === node.id;
              const isHovered = hoveredId === node.id;
              const isDimmed = hoveredId && !connectedNodes.has(node.id);
              const color = portraitColor(node.id);

              return (
                <g
                  key={node.id}
                  className="graph-node"
                  transform={`translate(${pos.x}, ${pos.y})`}
                  style={{ cursor: "pointer", opacity: isDimmed ? 0.2 : 1 }}
                  onClick={() => setSelectedId(isSelected ? null : node.id)}
                  onPointerEnter={() => setHoveredId(node.id)}
                  onPointerLeave={() => setHoveredId(null)}
                >
                  <circle
                    r={28}
                    fill={color}
                    stroke={isSelected ? "var(--ink)" : isHovered ? "var(--forest-dark)" : "white"}
                    strokeWidth={isSelected ? 3 : isHovered ? 2.5 : 2}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="white"
                    fontSize="13"
                    fontFamily="var(--font-serif), Georgia, serif"
                    fontWeight="600"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {initials(node.label)}
                  </text>
                  <text
                    y={42}
                    textAnchor="middle"
                    fill="var(--ink)"
                    fontSize="13"
                    fontFamily="var(--font-sans), Arial, sans-serif"
                    fontWeight="600"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {node.label}
                  </text>
                  {node.subtitle ? (
                    <text
                      y={58}
                      textAnchor="middle"
                      fill="var(--muted)"
                      fontSize="11"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {node.subtitle}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {!settled ? (
              <text
                x={viewBox.x + viewBox.w / 2}
                y={viewBox.y + viewBox.h - 20}
                textAnchor="middle"
                fill="var(--muted)"
                fontSize="12"
              >
                Layout settling...
              </text>
            ) : null}
          </svg>
        </div>

        <aside className="graph-legend">
          <h3>Relationships</h3>
          <ul>
            <li><svg width="32" height="12"><line x1="0" y1="6" x2="32" y2="6" stroke="var(--forest)" strokeWidth="2.5" /></svg> Spouse</li>
            <li><svg width="32" height="12"><line x1="0" y1="6" x2="32" y2="6" stroke="var(--forest)" strokeWidth="1.8" markerEnd="url(#arrow)" /><defs><marker id="legend-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--forest)" /></marker></defs></svg> Parent of</li>
            <li><svg width="32" height="12"><line x1="0" y1="6" x2="32" y2="6" stroke="var(--forest)" strokeWidth="1.8" /></svg> Sibling</li>
            <li><svg width="32" height="12"><line x1="0" y1="6" x2="32" y2="6" stroke="var(--forest)" strokeWidth="1.8" strokeDasharray="6 4" markerEnd="url(#arrow)" /><defs><marker id="legend-arrow-dash" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--forest)" /></marker></defs></svg> Godparent</li>
            <li><svg width="32" height="12"><line x1="0" y1="6" x2="32" y2="6" stroke="var(--forest)" strokeWidth="1.8" strokeDasharray="2 3" /></svg> Close friend</li>
            <li><svg width="32" height="12"><line x1="0" y1="6" x2="32" y2="6" stroke="#aaa99f" strokeWidth="1.8" strokeDasharray="6 4" /></svg> Ended</li>
          </ul>
        </aside>

        {selectedPerson ? (
          <div className="graph-detail">
            <div className="graph-detail-header">
              <h3>{selectedPerson.displayName}</h3>
              <button
                className="text-button"
                type="button"
                onClick={() => setSelectedId(null)}
              >
                Close
              </button>
            </div>
            {selectedPerson.birthDate ? (
              <p>Born {selectedPerson.birthDate}</p>
            ) : (
              <p>Birth date not recorded.</p>
            )}
            {selectedRelationships.length > 0 ? (
              <>
                <h4>Relationships</h4>
                <ul className="graph-detail-list">
                  {selectedRelationships.map((r) => (
                    <li key={r.id}>
                      <span>
                        {RELATIONSHIP_LABELS[r.relationshipType ?? ""] ?? r.relationshipType}
                        {" · "}
                        {r.sourcePersonId === selectedPerson.id
                          ? personName(r.targetPersonId)
                          : personName(r.sourcePersonId)}
                      </span>
                      {r.endedAt ? (
                        <span className="relationship-mode">Ended</span>
                      ) : r.evidenceMode === "oral" ? (
                        <span className="relationship-mode">Oral</span>
                      ) : (
                        <span className="relationship-mode">Documented</span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>No relationships recorded for this person.</p>
            )}
          </div>
        ) : null}

        {people.length === 0 ? (
          <div className="graph-empty">
            <p>No people are visible yet. Add people from the <Link href="/family">dashboard</Link>.</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
