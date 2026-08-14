import { useCallback, useEffect, useRef } from "react";

const CONTENT_LABELS = ["Note", "File", "Chat", "Calendar", "Agent", "Task", "Event"];
const MAX_LABELED = 20;
const AMBIENT_COUNT = 26;
const CONNECTION_DIST = 320;
const MAX_PULSES = 10;

interface NetNode {
  x: number;
  y: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  radius: number;
  angle: number;
  orbitR: number;
  speed: number;
  label?: string;
  glowPhase?: number;
}

interface Pulse {
  from: number;
  to: number;
  t: number;
  speed: number;
  life: number;
}

export function useAuthNetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<NetNode[]>([]);
  const pulsesRef = useRef<Pulse[]>([]);
  const rafRef = useRef(0);
  const prevRef = useRef(0);
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });
  const labeledCountRef = useRef(0);
  const spawnTimerRef = useRef(0);

  const init = useCallback((w: number, h: number) => {
    const nodes: NetNode[] = [];
    const panelW = w * 0.52;

    const youCx = panelW * (0.15 + Math.random() * 0.7);
    const youCy = h * (0.25 + Math.random() * 0.5);
    nodes.push({
      x: youCx,
      y: youCy,
      cx: youCx,
      cy: youCy,
      vx: (Math.random() - 0.5) * 0.04,
      vy: (Math.random() - 0.5) * 0.04,
      radius: 6,
      angle: Math.random() * Math.PI * 2,
      orbitR: 10 + Math.random() * 8,
      speed: 0.0003 + Math.random() * 0.00025,
      label: "You",
      glowPhase: Math.random() * Math.PI * 2,
    });

    const extraCount = 7 + Math.floor(Math.random() * 13);
    for (let i = 0; i < extraCount; i++) {
      const label = CONTENT_LABELS[Math.floor(Math.random() * CONTENT_LABELS.length)];
      const cx = w * (0.04 + Math.random() * 0.92);
      const cy = h * (0.04 + Math.random() * 0.92);
      nodes.push({
        x: cx,
        y: cy,
        cx,
        cy,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        radius: 4.5,
        angle: Math.random() * Math.PI * 2,
        orbitR: 15 + Math.random() * 20,
        speed: 0.0003 + Math.random() * 0.00025,
        label,
        glowPhase: Math.random() * Math.PI * 2,
      });
    }
    labeledCountRef.current = 1 + extraCount;
    spawnTimerRef.current = 1500 + Math.random() * 3000;

    const centerX = panelW * 0.52;
    const centerY = h * 0.52;
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.min(w * 0.5, h) * (0.15 + Math.random() * 0.45);
      const cx = centerX + Math.cos(angle) * dist;
      const cy = centerY + Math.sin(angle) * dist;
      nodes.push({
        x: cx,
        y: cy,
        cx,
        cy,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        radius: 1.5 + Math.random() * 1.5,
        angle: Math.random() * Math.PI * 2,
        orbitR: 10 + Math.random() * 25,
        speed: 0.0002 + Math.random() * 0.0004,
      });
    }

    const rightW = w - panelW;
    for (let i = 0; i < 18; i++) {
      const rx =
        i < 10
          ? panelW + rightW * (0.02 + Math.random() * 0.35)
          : panelW + rightW * (0.25 + Math.random() * 0.65);
      const ry = h * (0.08 + Math.random() * 0.84);
      nodes.push({
        x: rx,
        y: ry,
        cx: rx,
        cy: ry,
        vx: (Math.random() - 0.5) * 0.1,
        vy: (Math.random() - 0.5) * 0.1,
        radius: 1.2 + Math.random() * 1.3,
        angle: Math.random() * Math.PI * 2,
        orbitR: 8 + Math.random() * 18,
        speed: 0.0002 + Math.random() * 0.0003,
      });
    }

    nodesRef.current = nodes;
    pulsesRef.current = [];
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (nodesRef.current.length === 0) init(rect.width, rect.height);
    };

    resize();
    window.addEventListener("resize", resize);

    const HIT_RADIUS = 28;

    const getCanvasPos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const isOverYou = (mx: number, my: number) => {
      for (const n of nodesRef.current) {
        if (n.label !== "You") continue;
        const dx = mx - n.x;
        const dy = my - n.y;
        if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) return true;
      }
      return false;
    };

    const onMouseDown = (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      if (isOverYou(pos.x, pos.y)) {
        dragRef.current = { active: true, lastX: pos.x, lastY: pos.y };
        canvas.style.cursor = "grabbing";
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const drag = dragRef.current;

      if (drag.active) {
        const deltaX = pos.x - drag.lastX;
        const deltaY = pos.y - drag.lastY;
        drag.lastX = pos.x;
        drag.lastY = pos.y;
        for (const n of nodesRef.current) {
          n.cx += deltaX;
          n.cy += deltaY;
        }
      } else {
        canvas.style.cursor = isOverYou(pos.x, pos.y) ? "grab" : "";
      }
    };

    const onMouseUp = () => {
      if (dragRef.current.active) {
        dragRef.current.active = false;
        canvas.style.cursor = "";
      }
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    const draw = (ts: number) => {
      const dt = ts - prevRef.current;
      prevRef.current = ts;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const nodes = nodesRef.current;
      const pulses = pulsesRef.current;

      const panelW = w * 0.52;

      const splitX = panelW;
      const transW = 150;
      const ncT = (x: number) => Math.max(0, Math.min(1, (x - splitX + transW / 2) / transW));
      const nc = (x: number, a: number): string => {
        const t = ncT(x);
        const v = Math.round(255 - t * 225);
        const boostedAlpha = a * (1 + t * 2.5);
        return `rgba(${v},${v},${Math.round(255 - t * 215)},${Math.min(boostedAlpha, 1)})`;
      };

      const fzL = panelW + (w - panelW) * 0.05;
      const fzR = w - (w - panelW) * 0.05;
      const fzT = h * 0.12;
      const fzB = h * 0.88;

      for (const n of nodes) {
        n.angle += n.speed * dt;
        n.x = n.cx + Math.cos(n.angle) * n.orbitR;
        n.y = n.cy + Math.sin(n.angle * 0.7) * n.orbitR * 0.6;
        n.cx += n.vx * 0.015;
        n.cy += n.vy * 0.015;
      }

      if (labeledCountRef.current < MAX_LABELED) {
        spawnTimerRef.current -= dt;
        if (spawnTimerRef.current <= 0) {
          const label = CONTENT_LABELS[Math.floor(Math.random() * CONTENT_LABELS.length)];
          const cx = w * (0.04 + Math.random() * 0.92);
          const cy = h * (0.04 + Math.random() * 0.92);
          nodes.push({
            x: cx,
            y: cy,
            cx,
            cy,
            vx: (Math.random() - 0.5) * 0.12,
            vy: (Math.random() - 0.5) * 0.12,
            radius: 4.5,
            angle: Math.random() * Math.PI * 2,
            orbitR: 15 + Math.random() * 20,
            speed: 0.0003 + Math.random() * 0.00025,
            label,
            glowPhase: Math.random() * Math.PI * 2,
          });
          labeledCountRef.current++;
          spawnTimerRef.current = 1500 + Math.random() * 3000;
        }
      }

      const conns: [number, number][] = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            conns.push([i, j]);
            const isLabeledConn = !!nodes[i].label || !!nodes[j].label;
            const alpha = (isLabeledConn ? 0.24 : 0.16) * (1 - dist / CONNECTION_DIST);
            const midX = (nodes[i].x + nodes[j].x) / 2;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = nc(midX, alpha);
            ctx.lineWidth = isLabeledConn ? 1.2 : 0.9;
            ctx.stroke();
          }
        }
      }

      if (conns.length > 0 && pulses.length < MAX_PULSES && Math.random() < 0.015) {
        const [f, t] = conns[Math.floor(Math.random() * conns.length)];
        pulses.push({
          from: f,
          to: t,
          t: 0,
          speed: 0.00012 + Math.random() * 0.00018,
          life: 1,
        });
      }

      for (let p = pulses.length - 1; p >= 0; p--) {
        const pulse = pulses[p];
        pulse.t += pulse.speed * dt;
        if (pulse.t > 1) pulse.life -= 0.025;
        if (pulse.life <= 0) {
          pulses.splice(p, 1);
          continue;
        }

        const prog = Math.min(pulse.t, 1);
        const a = nodes[pulse.from];
        const b = nodes[pulse.to];
        const px = a.x + (b.x - a.x) * prog;
        const py = a.y + (b.y - a.y) * prog;
        const alpha = 0.6 * pulse.life;

        const grad = ctx.createRadialGradient(px, py, 0, px, py, 10);
        grad.addColorStop(0, nc(px, alpha));
        grad.addColorStop(1, nc(px, 0));
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fillStyle = nc(px, alpha * 0.9);
        ctx.fill();
      }

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const inFormZone = n.x > fzL && n.x < fzR && n.y > fzT && n.y < fzB;

        if (n.label && !inFormZone) {
          const glowPulse = 0.5 + 0.5 * Math.sin(ts * 0.001 + (n.glowPhase ?? 0));
          const isUsers = n.label === "You";

          if (isUsers) {
            const ringR = 14 + glowPulse * 3;
            const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, ringR + 12);
            glow.addColorStop(0, nc(n.x, 0.15 + glowPulse * 0.08));
            glow.addColorStop(0.6, nc(n.x, 0.04 + glowPulse * 0.03));
            glow.addColorStop(1, nc(n.x, 0));
            ctx.beginPath();
            ctx.arc(n.x, n.y, ringR + 12, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(n.x, n.y, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = nc(n.x, 0.35 + glowPulse * 0.25);
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(n.x, n.y, ringR - 3, 0, Math.PI * 2);
            ctx.fillStyle = nc(n.x, 0.08 + glowPulse * 0.04);
            ctx.fill();

            const iconAlpha = 0.75 + glowPulse * 0.25;
            ctx.beginPath();
            ctx.arc(n.x, n.y - 3, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = nc(n.x, iconAlpha);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(n.x, n.y + 7, 5.5, Math.PI, 0, false);
            ctx.fillStyle = nc(n.x, iconAlpha);
            ctx.fill();
          } else {
            const haloR = 18 + glowPulse * 4;
            const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, haloR);
            halo.addColorStop(0, nc(n.x, 0.12 + glowPulse * 0.06));
            halo.addColorStop(0.5, nc(n.x, 0.04 + glowPulse * 0.02));
            halo.addColorStop(1, nc(n.x, 0));
            ctx.beginPath();
            ctx.arc(n.x, n.y, haloR, 0, Math.PI * 2);
            ctx.fillStyle = halo;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
            ctx.fillStyle = nc(n.x, 0.7 + glowPulse * 0.3);
            ctx.fill();
          }

          const labelY = isUsers ? n.y + 22 : n.y + n.radius + 8;
          ctx.font = `${isUsers ? "600 12px" : "500 11px"} system-ui, -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = nc(n.x, 0.55 + glowPulse * 0.15);
          ctx.fillText(n.label, n.x, labelY);
        } else {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
          ctx.fillStyle = nc(n.x, 0.2);
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mousedown", onMouseDown);
      cancelAnimationFrame(rafRef.current);
    };
  }, [init]);

  return canvasRef;
}
