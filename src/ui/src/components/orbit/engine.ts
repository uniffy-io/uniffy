// A small orbit of mentions around a hub, drawn in the app's own theme colors. Scenes describe
// what orbits; nodes ease between scenes instead of being rebuilt, so the picture reads as one
// workspace that changes shape as the user acts.
import { brandAlpha, mixHex } from "@/config/theme/brandGradients";

export type RingIndex = 1 | 2 | 3;

export interface OrbitNode {
  id: string;
  label: string;
  /** Dot gradient; the label leans toward the first stop. */
  colors: [string, string];
  ring: RingIndex;
  /** Fraction of a turn where the node sits on its ring. */
  angle: number;
  glyph?: "person";
  emphasis?: boolean;
}

export interface OrbitScene {
  hubLabel: string;
  nodes: OrbitNode[];
  /** 0 draws spokes only; 1 links every neighbour, the way open sharing does. */
  mesh: number;
  converge: boolean;
  /** Folds every node into the hub, which flares; the launch curtain opens from there. */
  collapse: boolean;
}

/** Theme colors as hex, read from the stylesheet so light, dark and the user accent all apply. */
export interface OrbitPalette {
  ink: string;
  muted: string;
  primary: string;
  dark: boolean;
  font: string;
}

interface LiveNode extends OrbitNode {
  x: number;
  y: number;
  radius: number;
  targetRadius: number;
  alpha: number;
  leaving: boolean;
  phase: number;
  flash: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Pulse {
  nodeId: string;
  t: number;
  speed: number;
  inbound: boolean;
}

const RING_SPEED: Record<RingIndex, number> = { 1: 0.03, 2: -0.019, 3: 0.011 };
const RING_SCALE: Record<RingIndex, number> = { 1: 0.4, 2: 0.7, 3: 0.97 };
const MOTE_COUNT = 14;
const MAX_PULSES = 4;
const TAU = Math.PI * 2;

/** Frame-rate independent easing toward a target. */
const approach = (current: number, target: number, dt: number, rate: number) =>
  current + (target - current) * (1 - Math.exp(-dt * rate));

export class Orbit {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private nodes = new Map<string, LiveNode>();
  private motes: Mote[] = [];
  private pulses: Pulse[] = [];
  private scene: OrbitScene | null = null;
  private palette: OrbitPalette;
  private primary: string;
  private mesh = 0;
  private convergeT = 0;
  private hubFlash = 0;
  private rotation = 0;
  private raf = 0;
  private prev = 0;
  private sinceSpawn = 0;
  private running = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    palette: OrbitPalette,
    private readonly reducedMotion: boolean,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.palette = palette;
    this.primary = palette.primary;
  }

  resize(width: number, height: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.motes.length === 0) this.seedMotes();
    this.layout(true);
    this.paintIfStill();
  }

  setPalette(palette: OrbitPalette) {
    const accentChanged = palette.primary !== this.palette.primary;
    this.palette = palette;
    if (this.reducedMotion || !this.running) this.primary = palette.primary;
    if (accentChanged && this.scene) this.hubFlash = Math.max(this.hubFlash, 0.8);
    this.paintIfStill();
  }

  setScene(scene: OrbitScene) {
    const previous = this.scene;
    this.scene = scene;
    const incoming = new Set(scene.nodes.map((node) => node.id));
    for (const live of this.nodes.values()) {
      if (!incoming.has(live.id)) live.leaving = true;
    }
    for (const node of scene.nodes) {
      const live = this.nodes.get(node.id);
      if (live) {
        Object.assign(live, node, { leaving: false });
      } else {
        this.nodes.set(node.id, {
          ...node,
          x: this.width / 2,
          y: this.height / 2,
          radius: 0,
          targetRadius: 0,
          alpha: this.reducedMotion ? 1 : 0,
          leaving: false,
          phase: Math.random() * TAU,
          flash: previous ? 1 : 0,
        });
      }
    }
    this.layout(this.reducedMotion);
    if (this.reducedMotion) {
      this.mesh = scene.mesh;
      this.convergeT = scene.converge ? 1 : 0;
      for (const [id, live] of this.nodes) if (live.leaving) this.nodes.delete(id);
    }
    this.paintIfStill();
  }

  start() {
    if (this.running || this.reducedMotion) return;
    this.running = true;
    this.prev = performance.now();
    const tick = (ts: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (ts - this.prev) / 1000);
      this.prev = ts;
      this.step(dt);
      this.paint(ts / 1000);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private paintIfStill() {
    if (!this.running) this.paint(performance.now() / 1000);
  }

  private reach() {
    return Math.min(this.width, this.height) * 0.42;
  }

  private layout(snap: boolean) {
    const reach = this.reach();
    for (const live of this.nodes.values()) {
      live.targetRadius = reach * RING_SCALE[live.ring];
      if (snap) live.radius = live.targetRadius;
    }
  }

  private seedMotes() {
    this.motes = Array.from({ length: MOTE_COUNT }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
    }));
  }

  private step(dt: number) {
    const scene = this.scene;
    if (!scene) return;
    this.rotation += dt;
    this.primary = mixHex(this.primary, this.palette.primary, 1 - Math.exp(-dt * 4));
    this.mesh = approach(this.mesh, scene.mesh, dt, 3);
    this.convergeT = approach(this.convergeT, scene.converge ? 1 : 0, dt, 1.6);
    this.hubFlash = scene.collapse
      ? approach(this.hubFlash, 1.4, dt, 5)
      : Math.max(0, this.hubFlash - dt * 0.9);

    for (const [id, live] of this.nodes) {
      const ringRadius = live.targetRadius * (1 - this.convergeT * 0.6);
      live.radius = approach(
        live.radius,
        scene.collapse ? 0 : ringRadius,
        dt,
        scene.collapse ? 6 : 2.4,
      );
      const fading = live.leaving || scene.collapse;
      live.alpha = approach(live.alpha, fading ? 0 : 1, dt, fading ? 5 : 2.2);
      live.flash = Math.max(0, live.flash - dt * 0.7);
      if (live.leaving && live.alpha < 0.02) this.nodes.delete(id);
    }

    for (const mote of this.motes) {
      mote.x = (mote.x + mote.vx * dt + this.width) % this.width;
      mote.y = (mote.y + mote.vy * dt + this.height) % this.height;
    }

    this.sinceSpawn += dt;
    const cadence = scene.collapse ? 0.06 : scene.converge ? 0.4 : 1.1;
    const targets = [...this.nodes.values()].filter((node) => !node.leaving);
    if (this.sinceSpawn > cadence && this.pulses.length < MAX_PULSES * (scene.collapse ? 3 : 1)) {
      this.sinceSpawn = 0;
      const target = targets[Math.floor(Math.random() * targets.length)];
      if (target) {
        this.pulses.push({
          nodeId: target.id,
          t: 0,
          speed: 0.45 + Math.random() * 0.35,
          inbound: scene.collapse || Math.random() < 0.5,
        });
      }
    }
    this.pulses = this.pulses.filter((pulse) => {
      pulse.t += pulse.speed * dt;
      if (pulse.t < 1) return true;
      const node = this.nodes.get(pulse.nodeId);
      if (pulse.inbound) this.hubFlash = Math.max(this.hubFlash, 0.25);
      else if (node) node.flash = Math.max(node.flash, 0.5);
      return false;
    });
  }

  private paint(seconds: number) {
    const { ctx, palette } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.scene) return;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const reach = this.reach();
    const glow = palette.dark ? 1 : 0.7;
    const nodes = [...this.nodes.values()];
    for (const live of nodes) {
      const turn = live.angle * TAU + this.rotation * RING_SPEED[live.ring];
      live.x = cx + Math.cos(turn) * live.radius;
      live.y = cy + Math.sin(turn) * live.radius * 0.9;
    }

    for (const mote of this.motes) {
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, 1, 0, TAU);
      ctx.fillStyle = brandAlpha(palette.ink, 0.12);
      ctx.fill();
    }

    ctx.lineWidth = 1;
    for (const ring of [1, 2, 3] as const) {
      const r = reach * RING_SCALE[ring] * (1 - this.convergeT * 0.6);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.9, 0, 0, TAU);
      ctx.setLineDash(ring === 3 ? [2, 6] : []);
      ctx.strokeStyle = brandAlpha(palette.ink, ring === 3 ? 0.12 : 0.08);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (this.mesh > 0.01) {
      const limit = reach * 0.95;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > limit) continue;
          const alpha = (1 - distance / limit) * 0.22 * this.mesh * Math.min(a.alpha, b.alpha);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = brandAlpha(palette.ink, alpha);
          ctx.stroke();
        }
      }
    }

    for (const live of nodes) {
      const spoke = ctx.createLinearGradient(cx, cy, live.x, live.y);
      spoke.addColorStop(0, brandAlpha(this.primary, 0.32 * live.alpha));
      spoke.addColorStop(1, brandAlpha(live.colors[0], 0.14 * live.alpha));
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(live.x, live.y);
      ctx.strokeStyle = spoke;
      ctx.setLineDash(live.glyph === "person" ? [] : [3, 5]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const pulse of this.pulses) {
      const node = this.nodes.get(pulse.nodeId);
      if (!node) continue;
      const t = pulse.inbound ? 1 - pulse.t : pulse.t;
      const px = cx + (node.x - cx) * t;
      const py = cy + (node.y - cy) * t;
      const halo = ctx.createRadialGradient(px, py, 0, px, py, 9);
      halo.addColorStop(0, brandAlpha(this.primary, 0.45 * glow));
      halo.addColorStop(1, brandAlpha(this.primary, 0));
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, TAU);
      ctx.fillStyle = halo;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, TAU);
      ctx.fillStyle = this.primary;
      ctx.fill();
    }

    for (const live of nodes) this.paintNode(live, seconds, glow);
    this.paintHub(cx, cy, seconds, glow);
  }

  private paintNode(live: LiveNode, seconds: number, glow: number) {
    const { ctx, palette } = this;
    const breathe = 0.5 + 0.5 * Math.sin(seconds * 1.1 + live.phase);
    const a = live.alpha;
    const [start, end] = live.colors;

    if (live.glyph === "person") {
      const ring = 11 + breathe * 1.5;
      ctx.beginPath();
      ctx.arc(live.x, live.y, ring, 0, TAU);
      ctx.fillStyle = brandAlpha(start, 0.1 * a * glow);
      ctx.fill();
      ctx.strokeStyle = brandAlpha(start, (0.55 + live.flash * 0.3) * a);
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = brandAlpha(start, 0.85 * a);
      ctx.beginPath();
      ctx.arc(live.x, live.y - 2.5, 2.8, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(live.x, live.y + 5.8, 4.5, Math.PI, 0, false);
      ctx.fill();
    } else {
      const size = live.emphasis ? 6 : 4;
      const halo = 11 + breathe * 3 + live.flash * 8 + (live.emphasis ? 7 : 0);
      const light = ctx.createRadialGradient(live.x, live.y, 0, live.x, live.y, halo);
      light.addColorStop(0, brandAlpha(start, (0.16 + live.flash * 0.25) * a * glow));
      light.addColorStop(1, brandAlpha(start, 0));
      ctx.beginPath();
      ctx.arc(live.x, live.y, halo, 0, TAU);
      ctx.fillStyle = light;
      ctx.fill();
      const dot = ctx.createLinearGradient(
        live.x - size,
        live.y - size,
        live.x + size,
        live.y + size,
      );
      dot.addColorStop(0, brandAlpha(start, a));
      dot.addColorStop(1, brandAlpha(end, a));
      ctx.beginPath();
      ctx.arc(live.x, live.y, size, 0, TAU);
      ctx.fillStyle = dot;
      ctx.fill();
    }

    const labelY = live.glyph === "person" ? live.y + 17 : live.y + (live.emphasis ? 12 : 9);
    ctx.font = `${live.emphasis ? 600 : 500} 11px ${palette.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = brandAlpha(
      live.emphasis ? palette.ink : mixHex(palette.muted, start, 0.3),
      (live.emphasis ? 0.95 : 0.8) * a,
    );
    ctx.fillText(live.label, live.x, labelY);
  }

  private paintHub(x: number, y: number, seconds: number, glow: number) {
    const { ctx, palette } = this;
    const scene = this.scene;
    if (!scene) return;
    const breathe = 0.5 + 0.5 * Math.sin(seconds * 0.9);
    const lift = this.hubFlash + this.convergeT * 0.4;
    const halo = 24 + breathe * 4 + lift * 30;
    const light = ctx.createRadialGradient(x, y, 0, x, y, halo);
    light.addColorStop(0, brandAlpha(this.primary, (0.28 + lift * 0.25) * glow));
    light.addColorStop(1, brandAlpha(this.primary, 0));
    ctx.beginPath();
    ctx.arc(x, y, halo, 0, TAU);
    ctx.fillStyle = light;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 14 + breathe * 1.5, 0, TAU);
    ctx.strokeStyle = brandAlpha(this.primary, 0.45);
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.arc(x, y, 8, 0, TAU);
    ctx.fillStyle = this.primary;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, TAU);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.font = `600 12px ${palette.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = brandAlpha(palette.ink, 0.9);
    ctx.fillText(scene.hubLabel, x, y + 22);
  }
}
