"use client";

import { useState } from "react";

type GraphNode = {
  id: string;
  label: string;
  birthDate?: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  connections: string[];
};

type GraphEdge = {
  source: string;
  target: string;
  type: string;
  ended: boolean;
};

type LayoutResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
};

const REPULSION = 8000;
const ATTRACTION = 0.005;
const EDGE_LENGTH = 160;
const DAMPING = 0.85;
const CENTER_GRAVITY = 0.01;
const ITERATIONS = 300;

function buildGraph(
  people: { id: string; displayName: string; birthDate?: string | null }[],
  relationships: { id: string; sourcePersonId: string; targetPersonId: string; relationshipType?: string | null; endedAt?: string | null }[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map<string, GraphNode>();
  for (const p of people) {
    nodeMap.set(p.id, {
      id: p.id,
      label: p.displayName,
      birthDate: p.birthDate,
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 400,
      vx: 0,
      vy: 0,
      connections: [],
    });
  }
  const edges: GraphEdge[] = [];
  for (const r of relationships) {
    const s = nodeMap.get(r.sourcePersonId);
    const t = nodeMap.get(r.targetPersonId);
    if (!s || !t) continue;
    if (!s.connections.includes(t.id)) s.connections.push(t.id);
    if (!t.connections.includes(s.id)) t.connections.push(s.id);
    edges.push({
      source: r.sourcePersonId,
      target: r.targetPersonId,
      type: r.relationshipType ?? "other",
      ended: r.endedAt !== null && r.endedAt !== undefined,
    });
  }
  return { nodes: Array.from(nodeMap.values()), edges };
}

function simulate(nodes: GraphNode[], edges: GraphEdge[]) {
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    for (const edge of edges) {
      const a = nodes.find((n) => n.id === edge.source);
      const b = nodes.find((n) => n.id === edge.target);
      if (!a || !b) continue;
      const edx = b.x - a.x;
      const edy = b.y - a.y;
      const dist = Math.sqrt(edx * edx + edy * edy);
      const force = (dist - EDGE_LENGTH) * ATTRACTION;
      const fx = (edx / Math.max(dist, 1)) * force;
      const fy = (edy / Math.max(dist, 1)) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (const node of nodes) {
      node.vx -= node.x * CENTER_GRAVITY;
      node.vy -= node.y * CENTER_GRAVITY;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }
  }
}

export function useGraphLayout(
  people: { id: string; displayName: string; birthDate?: string | null }[],
  relationships: { id: string; sourcePersonId: string; targetPersonId: string; relationshipType?: string | null; endedAt?: string | null }[],
): LayoutResult {
  const [layout] = useState(() => {
    const graph = buildGraph(people, relationships);
    simulate(graph.nodes, graph.edges);
    return graph;
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return {
    nodes: layout.nodes,
    edges: layout.edges,
    hoveredId,
    setHoveredId,
    selectedId,
    setSelectedId,
  };
}
