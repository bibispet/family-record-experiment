"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useGraphLayout } from "./useGraphLayout";

type Person = { id: string; displayName: string; birthDate?: string | null };
type Relationship = {
  id: string;
  sourcePersonId: string;
  targetPersonId: string;
  relationshipType?: string | null;
  evidenceMode?: string | null;
  endedAt?: string | null;
};

const EDGE_STYLES: Record<string, { stroke: string; strokeWidth: number; dashArray?: string; markerEnd?: string }> = {
  spouse_of: { stroke: "var(--rose)", strokeWidth: 2 },
  parent_of: { stroke: "var(--forest)", strokeWidth: 2, markerEnd: "url(#arrow)" },
  sibling_of: { stroke: "var(--ink)", strokeWidth: 1.5 },
  godparent_of: { stroke: "var(--gold)", strokeWidth: 1.5, dashArray: "6 4" },
  close_family_friend_of: { stroke: "var(--sage)", strokeWidth: 1.5, dashArray: "3 3" },
  other: { stroke: "var(--muted)", strokeWidth: 1.5, dashArray: "8 4" },
};

function getEdgeStyle(type: string, ended: boolean) {
  const base = EDGE_STYLES[type] ?? EDGE_STYLES.other;
  return { ...base, stroke: ended ? "#bbb" : base.stroke };
}

function isConnected(nodeId: string, targetId: string | null, edges: { source: string; target: string }[]): boolean {
  if (!targetId) return true;
  if (nodeId === targetId) return true;
  return edges.some(
    (e) => (e.source === nodeId && e.target === targetId) || (e.source === targetId && e.target === nodeId),
  );
}

type Props = {
  people: Person[];
  relationships: Relationship[];
};

export default function FamilyGraph({ people, relationships }: Props) {
  const graph = useGraphLayout(people, relationships);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const panRef = useRef({ dragging: false, lastX: 0, lastY: 0 });

  const padding = 60;
  const minX = Math.min(...graph.nodes.map((n) => n.x)) - padding;
  const maxX = Math.max(...graph.nodes.map((n) => n.x)) + padding;
  const minY = Math.min(...graph.nodes.map((n) => n.y)) - padding;
  const maxY = Math.max(...graph.nodes.map((n) => n.y)) + padding;
  const w = (maxX - minX) / zoom;
  const h = (maxY - minY) / zoom;
  const vx = minX / zoom - offset.x;
  const vy = minY / zoom - offset.y;
  const viewBox = `${vx} ${vy} ${w} ${h}`;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    panRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panRef.current.dragging) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - panRef.current.lastX) / rect.width) * (maxX - minX) / zoom;
    const dy = ((e.clientY - panRef.current.lastY) / rect.height) * (maxY - minY) / zoom;
    panRef.current.lastX = e.clientX;
    panRef.current.lastY = e.clientY;
    setOffset((prev) => ({ x: prev.x + dx / zoom, y: prev.y + dy / zoom }));
  }, [maxX, minX, maxY, minY, zoom]);

  const onPointerUp = useCallback(() => {
    panRef.current.dragging = false;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => Math.min(Math.max(prev * factor, 0.2), 5));
  }, []);

  const selectedPerson = useMemo(
    () => graph.selectedId ? people.find((p) => p.id === graph.selectedId) ?? null : null,
    [graph.selectedId, people],
  );
  const selectedRelationships = useMemo(
    () => graph.selectedId ? relationships.filter((r) => r.sourcePersonId === graph.selectedId || r.targetPersonId === graph.selectedId) : [],
    [graph.selectedId, relationships],
  );

  return (
    <div className="family-graph-container">
      <div className="family-graph-header">
        <p className="eyebrow">Relationship graph</p>
        <h1>Family tree</h1>
        <p>Drag to pan. Scroll to zoom. Click a person for details.</p>
      </div>

      <div className="family-graph-canvas">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className="family-graph-svg"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--forest)" />
            </marker>
          </defs>

          {graph.edges.map((edge, i) => {
            const s = graph.nodes.find((n) => n.id === edge.source);
            const t = graph.nodes.find((n) => n.id === edge.target);
            if (!s || !t) return null;
            const dimmed = graph.hoveredId && !isConnected(edge.source, graph.hoveredId, graph.edges) && !isConnected(edge.target, graph.hoveredId, graph.edges);
            const style = getEdgeStyle(edge.type, edge.ended);
            if (edge.type === "spouse_of") {
              const edx = t.x - s.x;
              const edy = t.y - s.y;
              const len = Math.max(Math.sqrt(edx * edx + edy * edy), 1);
              const nx = (-edy / len) * 3;
              const ny = (edx / len) * 3;
              return (
                <g key={i} opacity={dimmed ? 0.15 : 1}>
                  <line x1={s.x + nx} y1={s.y + ny} x2={t.x + nx} y2={t.y + ny} stroke={style.stroke} strokeWidth={style.strokeWidth} />
                  <line x1={s.x - nx} y1={s.y - ny} x2={t.x - nx} y2={t.y - ny} stroke={style.stroke} strokeWidth={style.strokeWidth} />
                </g>
              );
            }
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeDasharray={style.dashArray}
                markerEnd={style.markerEnd}
                opacity={dimmed ? 0.15 : 1}
              />
            );
          })}

          {graph.nodes.map((node) => {
            const dimmed = graph.hoveredId && !isConnected(node.id, graph.hoveredId, graph.edges);
            const isHovered = node.id === graph.hoveredId;
            const isSelected = node.id === graph.selectedId;
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                opacity={dimmed ? 0.15 : 1}
                onPointerEnter={() => graph.setHoveredId(node.id)}
                onPointerLeave={() => graph.setHoveredId(null)}
                onClick={(e) => { e.stopPropagation(); graph.setSelectedId(isSelected ? null : node.id); }}
                style={{ cursor: "pointer" }}
              >
                <circle
                  r={isSelected ? 28 : isHovered ? 26 : 22}
                  fill={isSelected ? "var(--forest)" : "white"}
                  stroke={isSelected ? "var(--forest-dark)" : isHovered ? "var(--forest)" : "var(--line)"}
                  strokeWidth={isSelected ? 2.5 : 2}
                  style={{ transition: "r 0.15s, fill 0.15s, stroke 0.15s" }}
                />
                <text
                  textAnchor="middle"
                  dy="-30"
                  fill={isSelected ? "var(--forest)" : "var(--ink)"}
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="var(--font-sans), Arial, sans-serif"
                >
                  {node.label}
                </text>
                {node.birthDate ? (
                  <text textAnchor="middle" dy="-18" fill="var(--muted)" fontSize="10" fontFamily="var(--font-sans), Arial, sans-serif">
                    {node.birthDate.slice(0, 4)}
                  </text>
                ) : null}
                <text
                  textAnchor="middle"
                  dy="5"
                  fill={isSelected ? "white" : "var(--forest)"}
                  fontSize="16"
                  fontWeight="600"
                  fontFamily="var(--font-serif), Georgia, serif"
                >
                  {node.label.charAt(0)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="family-graph-legend">
        <span><svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke="var(--rose)" strokeWidth="2" /></svg> Spouse</span>
        <span><svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke="var(--forest)" strokeWidth="2" markerEnd="url(#arrow)" /></svg> Parent</span>
        <span><svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke="var(--ink)" strokeWidth="1.5" /></svg> Sibling</span>
        <span><svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke="var(--gold)" strokeWidth="1.5" strokeDasharray="6 4" /></svg> Godparent</span>
        <span><svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke="var(--sage)" strokeWidth="1.5" strokeDasharray="3 3" /></svg> Close friend</span>
        <span><svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke="#bbb" strokeWidth="1.5" strokeDasharray="8 4" /></svg> Ended</span>
      </div>

      {selectedPerson ? (
        <div className="family-graph-detail">
          <div className="family-graph-detail-header">
            <h2>{selectedPerson.displayName}</h2>
            <button className="text-button" type="button" onClick={() => graph.setSelectedId(null)}>Close</button>
          </div>
          {selectedPerson.birthDate ? <p>Born {selectedPerson.birthDate}</p> : <p>No birth date recorded.</p>}
          {selectedRelationships.length > 0 ? (
            <ul>
              {selectedRelationships.map((r) => {
                const otherId = r.sourcePersonId === graph.selectedId ? r.targetPersonId : r.sourcePersonId;
                const other = people.find((p) => p.id === otherId);
                const direction = r.sourcePersonId === graph.selectedId ? "to" : "from";
                return (
                  <li key={r.id}>
                    <span className="family-graph-edge-type">{(r.relationshipType ?? "other").replace(/_/g, " ")}</span>
                    {" "}{direction} <strong>{other?.displayName ?? "Unknown"}</strong>
                    {r.endedAt ? " (ended)" : ""}
                    {r.evidenceMode ? ` · ${r.evidenceMode}` : ""}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No relationships recorded.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
