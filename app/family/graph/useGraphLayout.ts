import { useEffect, useMemo, useRef, useState } from "react";

export type GraphNode = {
  id: string;
  label: string;
  subtitle?: string | null;
};

export type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  ended: boolean;
};

export type NodePosition = {
  id: string;
  x: number;
  y: number;
};

const REPULSION = 8000;
const ATTRACTION = 0.008;
const CENTERING = 0.01;
const DAMPING = 0.88;
const MIN_VELOCITY = 0.05;
const MAX_ITERATIONS = 300;

function initializePositions(nodes: GraphNode[]): Map<string, { x: number; y: number; vx: number; vy: number }> {
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const count = nodes.length;
  const radius = Math.max(120, count * 30);

  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / count;
    positions.set(node.id, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    });
  });

  return positions;
}

function simulate(
  positions: Map<string, { x: number; y: number; vx: number; vy: number }>,
  edges: GraphEdge[],
): boolean {
  let totalVelocity = 0;

  for (const [, pos] of positions) {
    pos.vx *= DAMPING;
    pos.vy *= DAMPING;
  }

  for (const [, a] of positions) {
    for (const [, b] of positions) {
      if (a === b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = REPULSION / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
    }
  }

  for (const edge of edges) {
    const a = positions.get(edge.sourceId);
    const b = positions.get(edge.targetId);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const force = (dist - 160) * ATTRACTION;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  for (const [, pos] of positions) {
    pos.vx -= pos.x * CENTERING;
    pos.vy -= pos.y * CENTERING;
    pos.x += pos.vx;
    pos.y += pos.vy;
    totalVelocity += Math.abs(pos.vx) + Math.abs(pos.vy);
  }

  return totalVelocity > MIN_VELOCITY * positions.size;
}

function snapshotPositions(sim: Map<string, { x: number; y: number }>): NodePosition[] {
  const result: NodePosition[] = [];
  for (const [id, pos] of sim) {
    result.push({ id, x: pos.x, y: pos.y });
  }
  return result;
}

type LayoutState = { positions: NodePosition[]; settled: boolean };

export function useGraphLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): LayoutState {
  const [state, setState] = useState<LayoutState>({
    positions: [],
    settled: nodes.length === 0,
  });
  const simRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }> | null>(null);
  const rafRef = useRef<number>(0);
  const iterRef = useRef(0);

  const nodeMap = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const validEdges = useMemo(
    () => edges.filter((e) => nodeMap.has(e.sourceId) && nodeMap.has(e.targetId)),
    [edges, nodeMap],
  );

  useEffect(() => {
    if (nodes.length === 0) return;

    simRef.current = initializePositions(nodes);
    iterRef.current = 0;

    function tick() {
      if (!simRef.current) return;
      const running = simulate(simRef.current, validEdges);
      iterRef.current++;

      const snapshot = snapshotPositions(simRef.current);

      if (running && iterRef.current < MAX_ITERATIONS) {
        setState({ positions: snapshot, settled: false });
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setState({ positions: snapshot, settled: true });
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [nodes, validEdges]);

  return state;
}
