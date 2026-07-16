import React, { useRef, useEffect, useState } from "react";
import { useWindowDimensions } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

const LABELS = ["Note", "File", "Chat", "Calendar", "Workflow", "Assistant"];
const MAX_LABELED = 8;
const AMBIENT_COUNT = 18;
const CONNECTION_DIST = 200;
const MAX_PULSES = 6;

interface Node {
  x: number;
  y: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  angle: number;
  orbitR: number;
  speed: number;
  radius: number;
  label: string | null;
  alpha: number;
  glowPhase: number;
}

interface Pulse {
  fromIdx: number;
  toIdx: number;
  t: number;
  speed: number;
  life: number;
}

function createNode(w: number, h: number, label: string | null): Node {
  const margin = 40;
  return {
    cx: margin + Math.random() * (w - margin * 2),
    cy: margin + Math.random() * (h - margin * 2),
    x: 0,
    y: 0,
    vx: (Math.random() - 0.5) * 0.1,
    vy: (Math.random() - 0.5) * 0.1,
    angle: Math.random() * Math.PI * 2,
    orbitR: label ? 8 + Math.random() * 20 : 4 + Math.random() * 12,
    speed: (0.0003 + Math.random() * 0.0005) * (Math.random() < 0.5 ? 1 : -1),
    radius: label ? 4 : 1.5 + Math.random() * 1.5,
    label,
    alpha: label ? 0.7 : 0.15 + Math.random() * 0.1,
    glowPhase: Math.random() * Math.PI * 2,
  };
}

function initNodes(w: number, h: number): Node[] {
  const nodes: Node[] = [];

  // "You" node centered upper area
  const youNode = createNode(w, h, "You");
  youNode.cx = w * 0.5;
  youNode.cy = h * 0.3;
  youNode.radius = 6;
  youNode.alpha = 0.9;
  nodes.push(youNode);

  // Labeled feature nodes
  for (let i = 0; i < MAX_LABELED - 1; i++) {
    nodes.push(createNode(w, h, LABELS[i % LABELS.length]));
  }

  // Ambient dots
  for (let i = 0; i < AMBIENT_COUNT; i++) {
    nodes.push(createNode(w, h, null));
  }

  // Initialize positions
  for (const n of nodes) {
    n.x = n.cx + Math.cos(n.angle) * n.orbitR;
    n.y = n.cy + Math.sin(n.angle * 0.7) * n.orbitR * 0.6;
  }

  return nodes;
}

export function NetworkCanvas() {
  const { width, height } = useWindowDimensions();
  // Physics lives in refs (mutated in place each frame, no per-frame allocation);
  // a snapshot is pushed to state so the SVG renders from state, not from a ref.
  const [frame, setFrame] = useState<{ nodes: Node[]; pulses: Pulse[] }>(() => ({
    nodes: initNodes(width, height),
    pulses: [],
  }));
  const nodesRef = useRef(frame.nodes);
  const pulsesRef = useRef(frame.pulses);
  const lastTimeRef = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const animate = (ts: number) => {
      const dt = lastTimeRef.current ? ts - lastTimeRef.current : 16;
      lastTimeRef.current = ts;

      const nodes = nodesRef.current;
      const pulses = pulsesRef.current;

      // Update node positions
      for (const n of nodes) {
        n.angle += n.speed * dt;
        n.cx += n.vx * 0.015;
        n.cy += n.vy * 0.015;

        if (n.cx < 20 || n.cx > width - 20) n.vx *= -1;
        if (n.cy < 20 || n.cy > height - 20) n.vy *= -1;

        n.x = n.cx + Math.cos(n.angle) * n.orbitR;
        n.y = n.cy + Math.sin(n.angle * 0.7) * n.orbitR * 0.6;
      }

      // Update pulses
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed * dt * 0.001;
        if (p.t >= 1) {
          p.life -= dt * 0.003;
          if (p.life <= 0) pulses.splice(i, 1);
        }
      }

      // Spawn new pulse
      if (pulses.length < MAX_PULSES && Math.random() < 0.01) {
        const a = Math.floor(Math.random() * nodes.length);
        const b = Math.floor(Math.random() * nodes.length);
        if (a !== b) {
          const dx = nodes[a].x - nodes[b].x;
          const dy = nodes[a].y - nodes[b].y;
          if (Math.sqrt(dx * dx + dy * dy) < CONNECTION_DIST) {
            pulses.push({ fromIdx: a, toIdx: b, t: 0, speed: 0.4 + Math.random() * 0.3, life: 1 });
          }
        }
      }

      setFrame({ nodes: [...nodes], pulses: [...pulses] });
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [width, height]);

  const { nodes, pulses } = frame;

  // Build connections
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CONNECTION_DIST) {
        const isLabeled = !!(nodes[i].label && nodes[j].label);
        const alpha = (isLabeled ? 0.2 : 0.1) * (1 - dist / CONNECTION_DIST);
        lines.push(
          <Line
            key={`l${i}-${j}`}
            x1={nodes[i].x}
            y1={nodes[i].y}
            x2={nodes[j].x}
            y2={nodes[j].y}
            stroke={`rgba(255,255,255,${alpha})`}
            strokeWidth={isLabeled ? 1 : 0.6}
          />,
        );
      }
    }
  }

  return (
    <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
      {/* Connection lines */}
      {lines}

      {/* Pulses */}
      {pulses.map((p, i) => {
        const a = nodes[p.fromIdx];
        const b = nodes[p.toIdx];
        const t = Math.min(p.t, 1);
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        return (
          <Circle key={`p${i}`} cx={px} cy={py} r={3} fill={`rgba(255,255,255,${0.4 * p.life})`} />
        );
      })}

      {/* Nodes */}
      {nodes.map((n, i) => {
        if (n.label === "You") {
          return (
            <React.Fragment key={`n${i}`}>
              <Circle cx={n.x} cy={n.y} r={12} fill="rgba(255,255,255,0.06)" />
              <Circle cx={n.x} cy={n.y} r={5} fill="rgba(255,255,255,0.7)" />
            </React.Fragment>
          );
        }

        if (n.label) {
          return (
            <React.Fragment key={`n${i}`}>
              <Circle cx={n.x} cy={n.y} r={10} fill="rgba(255,255,255,0.04)" />
              <Circle cx={n.x} cy={n.y} r={n.radius} fill={`rgba(255,255,255,${n.alpha})`} />
            </React.Fragment>
          );
        }

        return (
          <Circle
            key={`n${i}`}
            cx={n.x}
            cy={n.y}
            r={n.radius}
            fill={`rgba(255,255,255,${n.alpha})`}
          />
        );
      })}
    </Svg>
  );
}
