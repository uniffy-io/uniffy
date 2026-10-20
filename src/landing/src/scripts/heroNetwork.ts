// The mention network that animates the homepage hero and the live blog cover:
// a "You" node, labeled mentions that spawn over time, ambient dots, pulses
// along connections, and a draggable "You".
type NetNode = {
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
  color: string;
  gradStart: string;
  gradEnd: string;
  glowPhase: number;
  flash: number;
};

type Pulse = { from: number; to: number; t: number; speed: number; life: number };
type PathPulse = { path: number[]; seg: number; t: number; speed: number };

// Mirrors IDENTITY_PAIRS in src/ui/src/config/theme/brandGradients.ts so the
// graph nodes carry the same violet -> pink identity gradients as product avatars.
const IDENTITY_PAIRS: [string, string][] = [
  ["#694aff", "#fd7eea"],
  ["#fd7eea", "#694aff"],
  ["#694aff", "#b364f4"],
  ["#b364f4", "#fd7eea"],
  ["#543bcc", "#d871ef"],
  ["#8e57fa", "#fd7eea"],
  ["#694aff", "#d871ef"],
  ["#8e57fa", "#b364f4"],
];

const LABEL_POOL = [
  "@q3-roadmap",
  "@standup-notes",
  "@ideas",
  "@retro-notes",
  "@launch.pdf",
  "@budget.xlsx",
  "@logo.svg",
  "@demo.mp4",
  "@design-review",
  "@support",
  "@launch-week",
  "@friday-demo",
  "@offsite",
  "@ship-it",
  "@fix-login",
  "@scribe",
  "@drafter",
  "@researcher",
];

function mixHex(a: string, b: string, t: number): string {
  const ca = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const cb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function identityPair(key: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return IDENTITY_PAIRS[Math.abs(hash) % IDENTITY_PAIRS.length];
}
const PULSE_COLOR = "#8571ff";
const MAX_LABELED = 1 + LABEL_POOL.length;
const MAX_CONNECTION_DIST = 300;
const CURSOR_DIST = 170;
const MAX_PULSES = 6;
const MAX_YOU_PULSES = 3;

function rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(a, 1))})`;
}

export type NetworkFrame = "hero" | "full";

export function setupHeroNetwork(canvas: HTMLCanvasElement, frame: NetworkFrame = "hero"): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const wide = window.matchMedia("(min-width: 1024px)");

  let nodes: NetNode[] = [];
  let pulses: Pulse[] = [];
  let pathPulses: PathPulse[] = [];
  let youPulseTimer = 800;
  let raf = 0;
  let prev = 0;
  let labeledCount = 0;
  let maxLabeled = MAX_LABELED;
  let connectionDist = MAX_CONNECTION_DIST;
  let spawnTimer = 0;
  let running = false;
  let startedAt = 0;
  let size = { w: 0, h: 0 };
  let band = { x0: 0, y0: 0, x1: 0, y1: 0 };
  let wasWide = wide.matches;
  const drag = { active: false, lastX: 0, lastY: 0 };
  const pointer = { x: 0, y: 0, active: false };
  let poolOrder: string[] = [];
  let poolIdx = 0;

  const nextEntry = (): string => poolOrder[poolIdx++ % poolOrder.length];

  // On the homepage the veil hides the art under the text, so the graph only
  // lives in the revealed band: the right half on wide screens, the lower part
  // when stacked. A full frame uses the whole canvas with a small inset.
  // Density, reach and the labeled cap scale with the band's area.
  const fitToFrame = (w: number, h: number) => {
    band =
      frame === "full"
        ? { x0: w * 0.13, y0: h * 0.12, x1: w * 0.87, y1: h * 0.84 }
        : wide.matches
          ? { x0: w * 0.46, y0: h * 0.08, x1: w * 0.96, y1: h * 0.92 }
          : { x0: w * 0.06, y0: h * 0.66, x1: w * 0.94, y1: h * 0.96 };
    const bw = band.x1 - band.x0;
    const bh = band.y1 - band.y0;
    connectionDist = Math.min(MAX_CONNECTION_DIST, Math.max(150, bw * 0.3));
    const minLabeled = frame === "full" ? 5 : 7;
    maxLabeled = Math.min(MAX_LABELED, Math.max(minLabeled, Math.round((bw * bh) / 24000)));
  };

  // Labeled nodes stay inside the band so captions are never cut off, and
  // keep clear of its middle so they never sit on "You".
  const spawnPos = (labeled: boolean) => {
    const bw = band.x1 - band.x0;
    const bh = band.y1 - band.y0;
    const inset = labeled ? 0.1 : 0;
    const mx = band.x0 + bw * 0.5;
    const my = band.y0 + bh * 0.5;
    for (let attempt = 0; attempt < 6; attempt++) {
      const cx = band.x0 + bw * (inset + Math.random() * (1 - inset * 2));
      const cy = band.y0 + bh * (inset + Math.random() * (1 - inset * 2));
      const dx = cx - mx;
      const dy = cy - my;
      if (!labeled || dx * dx + dy * dy > 90 * 90) return { cx, cy };
    }
    return { cx: band.x0 + bw * 0.15, cy: my };
  };

  const makeNode = (label?: string): NetNode => {
    const { cx, cy } = spawnPos(!!label);
    const pair = label ? identityPair(label) : (["#ffffff", "#ffffff"] as [string, string]);
    return {
      x: cx,
      y: cy,
      cx,
      cy,
      vx: (Math.random() - 0.5) * 0.12,
      vy: (Math.random() - 0.5) * 0.12,
      radius: label ? 4.5 : 1.3 + Math.random() * 1.5,
      angle: Math.random() * Math.PI * 2,
      orbitR: label ? 15 + Math.random() * 20 : 8 + Math.random() * 22,
      speed: 0.0002 + Math.random() * 0.0003,
      label,
      color: label ? mixHex(pair[0], pair[1], 0.5) : "#ffffff",
      gradStart: pair[0],
      gradEnd: pair[1],
      glowPhase: Math.random() * Math.PI * 2,
      flash: 0,
    };
  };

  const init = (w: number, h: number) => {
    nodes = [];
    pulses = [];
    pathPulses = [];
    youPulseTimer = 800;
    poolOrder = [...LABEL_POOL].sort(() => Math.random() - 0.5);
    poolIdx = 0;
    fitToFrame(w, h);

    const bw = band.x1 - band.x0;
    const bh = band.y1 - band.y0;
    const you = makeNode("You");
    you.color = "#ffffff";
    you.gradStart = "#ffffff";
    you.gradEnd = "#ffffff";
    you.cx = band.x0 + bw * 0.5 + (Math.random() - 0.5) * bw * 0.12;
    you.cy = band.y0 + bh * 0.5 + (Math.random() - 0.5) * bh * 0.12;
    you.radius = 6;
    you.vx = (Math.random() - 0.5) * 0.04;
    you.vy = (Math.random() - 0.5) * 0.04;
    you.orbitR = 10 + Math.random() * 8;
    nodes.push(you);

    const labeledStart = Math.min(maxLabeled - 1, 6 + Math.floor(Math.random() * 3));
    for (let i = 0; i < labeledStart; i++) {
      nodes.push(makeNode(nextEntry()));
    }
    labeledCount = 1 + labeledStart;
    spawnTimer = 1500 + Math.random() * 3000;

    const ambient = Math.round(Math.min(44, (bw * bh) / 30000));
    for (let i = 0; i < ambient; i++) nodes.push(makeNode());
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (nodes.length === 0 || wasWide !== wide.matches) {
      wasWide = wide.matches;
      init(rect.width, rect.height);
    } else if (size.w !== rect.width || size.h !== rect.height) {
      const sx = rect.width / size.w;
      const sy = rect.height / size.h;
      for (const n of nodes) {
        n.cx *= sx;
        n.cy *= sy;
      }
      fitToFrame(rect.width, rect.height);
    }
    size = { w: rect.width, h: rect.height };
  };

  const draw = (ts: number) => {
    const dt = Math.min(ts - prev, 64);
    prev = ts;
    const w = size.w;
    const h = size.h;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.min(1, (ts - startedAt) / 1400);

    for (const n of nodes) {
      n.angle += n.speed * dt;
      n.x = n.cx + Math.cos(n.angle) * n.orbitR;
      n.y = n.cy + Math.sin(n.angle * 0.7) * n.orbitR * 0.6;
      n.cx += n.vx * 0.015;
      n.cy += n.vy * 0.015;
    }

    if (labeledCount < maxLabeled) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        nodes.push(makeNode(nextEntry()));
        labeledCount++;
        spawnTimer = 1500 + Math.random() * 3000;
      }
    }

    const conns: [number, number][] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < connectionDist) {
          conns.push([i, j]);
          const labeled = !!nodes[i].label || !!nodes[j].label;
          const alpha = (labeled ? 0.2 : 0.12) * (1 - dist / connectionDist);
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
          ctx.lineWidth = labeled ? 1.1 : 0.8;
          ctx.stroke();
        }
      }
    }

    if (pointer.active) {
      const halo = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 70);
      halo.addColorStop(0, "rgba(255,255,255,0.05)");
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 70, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();

      for (const n of nodes) {
        const dx = n.x - pointer.x;
        const dy = n.y - pointer.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CURSOR_DIST) {
          const strength = 1 - dist / CURSOR_DIST;
          const alpha = (n.label ? 0.3 : 0.16) * strength;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.strokeStyle = n.label ? rgba(n.color, alpha) : `rgba(255,255,255,${alpha})`;
          ctx.lineWidth = n.label ? 1.2 : 0.8;
          ctx.stroke();
        }
      }
    }

    if (conns.length > 0 && pulses.length < MAX_PULSES && Math.random() < 0.008) {
      const [f, t] = conns[Math.floor(Math.random() * conns.length)];
      pulses.push({ from: f, to: t, t: 0, speed: 0.00012 + Math.random() * 0.00018, life: 1 });
    }

    youPulseTimer -= dt;
    if (youPulseTimer <= 0 && pathPulses.length < MAX_YOU_PULSES) {
      const adj = new Map<number, number[]>();
      for (const [a, b] of conns) {
        const la = adj.get(a);
        if (la) la.push(b);
        else adj.set(a, [b]);
        const lb = adj.get(b);
        if (lb) lb.push(a);
        else adj.set(b, [a]);
      }
      const path = [0];
      let cur = 0;
      const hops = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < hops; i++) {
        const opts = (adj.get(cur) ?? []).filter((x) => !path.includes(x));
        if (opts.length === 0) break;
        const labeledOpts = opts.filter((x) => nodes[x].label);
        const pool = labeledOpts.length > 0 && (i === hops - 1 || Math.random() < 0.5) ? labeledOpts : opts;
        cur = pool[Math.floor(Math.random() * pool.length)];
        path.push(cur);
      }
      if (path.length > 1) {
        pathPulses.push({ path, seg: 0, t: 0, speed: 0.00035 + Math.random() * 0.0002 });
        youPulseTimer = 1400 + Math.random() * 2000;
      } else {
        youPulseTimer = 500;
      }
    }

    for (let p = pathPulses.length - 1; p >= 0; p--) {
      const pp = pathPulses[p];
      pp.t += pp.speed * dt;
      if (pp.t >= 1) {
        const arrive = nodes[pp.path[pp.seg + 1]];
        const isFinal = pp.seg + 2 >= pp.path.length;
        arrive.flash = Math.min(1, arrive.flash + (isFinal ? 1 : 0.6));
        pp.seg++;
        pp.t = 0;
        if (isFinal) {
          pathPulses.splice(p, 1);
          continue;
        }
      }
      const a = nodes[pp.path[pp.seg]];
      const b = nodes[pp.path[pp.seg + 1]];
      const px = a.x + (b.x - a.x) * pp.t;
      const py = a.y + (b.y - a.y) * pp.t;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(px, py);
      ctx.strokeStyle = rgba(PULSE_COLOR, 0.28);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      const grad = ctx.createRadialGradient(px, py, 0, px, py, 13);
      grad.addColorStop(0, rgba(PULSE_COLOR, 0.75));
      grad.addColorStop(1, rgba(PULSE_COLOR, 0));
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
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
      const alpha = 0.55 * pulse.life;

      const grad = ctx.createRadialGradient(px, py, 0, px, py, 11);
      grad.addColorStop(0, rgba(PULSE_COLOR, alpha));
      grad.addColorStop(1, rgba(PULSE_COLOR, 0));
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fillStyle = rgba("#ffffff", alpha * 0.9);
      ctx.fill();
    }

    for (const n of nodes) {
      if (n.flash > 0) n.flash = Math.max(0, n.flash - dt * 0.0012);

      if (n.label) {
        const glowPulse = 0.5 + 0.5 * Math.sin(ts * 0.001 + n.glowPhase);
        const isYou = n.label === "You";

        if (isYou) {
          const ringR = 14 + glowPulse * 3;
          const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, ringR + 12);
          glow.addColorStop(0, rgba(PULSE_COLOR, 0.2 + glowPulse * 0.1));
          glow.addColorStop(0.6, rgba(PULSE_COLOR, 0.05 + glowPulse * 0.03));
          glow.addColorStop(1, rgba(PULSE_COLOR, 0));
          ctx.beginPath();
          ctx.arc(n.x, n.y, ringR + 12, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(n.x, n.y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = rgba("#ffffff", 0.35 + glowPulse * 0.25);
          ctx.lineWidth = 1.5;
          ctx.stroke();

          const iconAlpha = 0.75 + glowPulse * 0.25;
          ctx.beginPath();
          ctx.arc(n.x, n.y - 3, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = rgba("#ffffff", iconAlpha);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(n.x, n.y + 7, 5.5, Math.PI, 0, false);
          ctx.fillStyle = rgba("#ffffff", iconAlpha);
          ctx.fill();
        } else {
          const haloR = 17 + glowPulse * 4 + n.flash * 10;
          const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, haloR);
          halo.addColorStop(0, rgba(n.color, 0.14 + glowPulse * 0.07 + n.flash * 0.3));
          halo.addColorStop(0.5, rgba(n.color, 0.05 + glowPulse * 0.02 + n.flash * 0.12));
          halo.addColorStop(1, rgba(n.color, 0));
          ctx.beginPath();
          ctx.arc(n.x, n.y, haloR, 0, Math.PI * 2);
          ctx.fillStyle = halo;
          ctx.fill();

          const dotAlpha = 0.8 + glowPulse * 0.2;
          const dot = ctx.createLinearGradient(
            n.x - n.radius,
            n.y - n.radius,
            n.x + n.radius,
            n.y + n.radius
          );
          dot.addColorStop(0, rgba(n.gradStart, dotAlpha));
          dot.addColorStop(1, rgba(n.gradEnd, dotAlpha));
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
          ctx.fillStyle = dot;
          ctx.fill();
        }

        const labelY = isYou ? n.y + 22 : n.y + n.radius + 8;
        ctx.font = `${isYou ? "600 12px" : "500 11px"} "JetBrains Mono Variable", ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isYou
          ? rgba("#ffffff", 0.6 + glowPulse * 0.15)
          : rgba(n.color, 0.55 + glowPulse * 0.2 + n.flash * 0.3);
        ctx.fillText(n.label, n.x, labelY);
      } else {
        if (n.flash > 0) {
          const fg = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 10);
          fg.addColorStop(0, rgba(PULSE_COLOR, 0.35 * n.flash));
          fg.addColorStop(1, rgba(PULSE_COLOR, 0));
          ctx.beginPath();
          ctx.arc(n.x, n.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = fg;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.18 + n.flash * 0.5})`;
        ctx.fill();
      }
    }

    if (running) raf = requestAnimationFrame(draw);
  };

  const start = () => {
    if (running) return;
    running = true;
    resize();
    prev = performance.now();
    if (!startedAt) startedAt = prev;
    raf = requestAnimationFrame(draw);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  const HIT_RADIUS = 28;
  const canvasPos = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const overYou = (mx: number, my: number) => {
    for (const n of nodes) {
      if (n.label !== "You") continue;
      const dx = mx - n.x;
      const dy = my - n.y;
      if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) return true;
    }
    return false;
  };

  canvas.style.pointerEvents = "auto";
  canvas.addEventListener("mousedown", (e) => {
    const pos = canvasPos(e);
    if (overYou(pos.x, pos.y)) {
      drag.active = true;
      drag.lastX = pos.x;
      drag.lastY = pos.y;
      canvas.style.cursor = "grabbing";
    }
  });
  window.addEventListener("mousemove", (e) => {
    const pos = canvasPos(e);
    pointer.x = pos.x;
    pointer.y = pos.y;
    pointer.active =
      !drag.active && pos.x >= 0 && pos.y >= 0 && pos.x <= size.w && pos.y <= size.h;
    if (drag.active) {
      const dx = pos.x - drag.lastX;
      const dy = pos.y - drag.lastY;
      drag.lastX = pos.x;
      drag.lastY = pos.y;
      for (const n of nodes) {
        n.cx += dx;
        n.cy += dy;
      }
    } else {
      canvas.style.cursor = overYou(pos.x, pos.y) ? "grab" : "";
    }
  });
  canvas.addEventListener("mouseleave", () => {
    pointer.active = false;
  });
  window.addEventListener("mouseup", () => {
    if (drag.active) {
      drag.active = false;
      canvas.style.cursor = "";
    }
  });

  const resizer = new ResizeObserver(() => {
    if (running) resize();
  });
  resizer.observe(canvas);

  let inView = false;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        inView = entry.isIntersecting;
        if (inView) start();
        else stop();
      }
    },
    { threshold: 0 }
  );
  observer.observe(canvas);

  // Tab switches and back-forward cache restores can leave a dead frame loop
  // behind; resume whenever the page becomes visible again while in view.
  const resume = () => {
    if (!document.hidden && inView) start();
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pageshow", resume);
}
