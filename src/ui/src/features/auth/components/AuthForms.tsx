import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createClient } from "@connectrpc/connect";
import { useNavigate } from 'react-router-dom';
import { AuthService } from "@uniffy/proto/auth/v1/auth_connect";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setCredentials } from "@/features/auth/store/authSlice";
import { setAccentColor, setFontFamily } from "@/config/theme/themeSlice";
import { transport, setMemoryAccessToken, friendlyErrorMessage } from "@/config";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { UniffyLogo } from "@/components/ui/uniffy-logo";
import { defaultTheme } from "@/config/theme/types";
import {
  Envelope,
  Lock,
  User,
  IdentificationCard,
} from "@phosphor-icons/react";

const authClient = createClient(AuthService, transport);

// Static brand colors — not from the theme engine so the auth page stays visually consistent
const BRAND_ACCENT = '#09090b';
const BRAND_ACCENT_RING = 'rgba(9, 9, 11, 0.15)';

// --- Connected network canvas for the auth page ---

const CONTENT_LABELS = ['Note', 'File', 'Chat', 'Calendar', 'Workflow', 'Agent'];
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

function useNetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<NetNode[]>([]);
  const pulsesRef = useRef<Pulse[]>([]);
  const rafRef = useRef(0);
  const prevRef = useRef(0);
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 });
  const labeledCountRef = useRef(0);
  const spawnTimerRef = useRef(0);

  const init = useCallback((w: number, h: number) => {
    const nodes: NetNode[] = [];
    const panelW = w * 0.52;

    // Place exactly one "You" node — always on the left panel
    const youCx = panelW * (0.15 + Math.random() * 0.7);
    const youCy = h * (0.25 + Math.random() * 0.5);
    nodes.push({
      x: youCx, y: youCy, cx: youCx, cy: youCy,
      vx: (Math.random() - 0.5) * 0.04,
      vy: (Math.random() - 0.5) * 0.04,
      radius: 6,
      angle: Math.random() * Math.PI * 2,
      orbitR: 10 + Math.random() * 8,
      speed: 0.0003 + Math.random() * 0.00025,
      label: 'You',
      glowPhase: Math.random() * Math.PI * 2,
    });

    // Place remaining labeled nodes (8-19 more, for 9-20 total including You)
    const extraCount = 7 + Math.floor(Math.random() * 13);
    for (let i = 0; i < extraCount; i++) {
      const label = CONTENT_LABELS[Math.floor(Math.random() * CONTENT_LABELS.length)];
      const cx = w * (0.04 + Math.random() * 0.92);
      const cy = h * (0.04 + Math.random() * 0.92);
      nodes.push({
        x: cx, y: cy, cx, cy,
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

    // Place ambient nodes — scattered across the full page
    const centerX = panelW * 0.52;
    const centerY = h * 0.52;
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.min(w * 0.5, h) * (0.15 + Math.random() * 0.45);
      const cx = centerX + Math.cos(angle) * dist;
      const cy = centerY + Math.sin(angle) * dist;
      nodes.push({
        x: cx, y: cy, cx, cy,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        radius: 1.5 + Math.random() * 1.5,
        angle: Math.random() * Math.PI * 2,
        orbitR: 10 + Math.random() * 25,
        speed: 0.0002 + Math.random() * 0.0004,
      });
    }

    // Right-panel ambient nodes — bridge nodes near boundary + scattered deeper
    const rightW = w - panelW;
    for (let i = 0; i < 18; i++) {
      const rx = i < 10
        ? panelW + rightW * (0.02 + Math.random() * 0.35)
        : panelW + rightW * (0.25 + Math.random() * 0.65);
      const ry = h * (0.08 + Math.random() * 0.84);
      nodes.push({
        x: rx, y: ry, cx: rx, cy: ry,
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
    const ctx = canvas.getContext('2d');
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
    window.addEventListener('resize', resize);

    const HIT_RADIUS = 28;

    const getCanvasPos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const isOverYou = (mx: number, my: number) => {
      for (const n of nodesRef.current) {
        if (n.label !== 'You') continue;
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
        canvas.style.cursor = 'grabbing';
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

        // Shift all node centers
        for (const n of nodesRef.current) {
          n.cx += deltaX;
          n.cy += deltaY;
        }
      } else {
        canvas.style.cursor = isOverYou(pos.x, pos.y) ? 'grab' : '';
      }
    };

    const onMouseUp = () => {
      if (dragRef.current.active) {
        dragRef.current.active = false;
        canvas.style.cursor = '';
      }
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    const draw = (ts: number) => {
      const dt = ts - prevRef.current;
      prevRef.current = ts;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) { rafRef.current = requestAnimationFrame(draw); return; }

      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const nodes = nodesRef.current;
      const pulses = pulsesRef.current;

      const panelW = w * 0.52;

      // Position-dependent color: white on dark left panel, near-black on light right panel
      const splitX = panelW;
      const transW = 150;
      const ncT = (x: number) => Math.max(0, Math.min(1, (x - splitX + transW / 2) / transW));
      const nc = (x: number, a: number): string => {
        const t = ncT(x);
        // Left: rgb(255,255,255) white. Right: rgb(30,30,40) near-black.
        // Alpha is boosted on the right side so low-alpha elements (connections) stay visible on white.
        const v = Math.round(255 - t * 225);
        const boostedAlpha = a * (1 + t * 2.5);
        return `rgba(${v},${v},${Math.round(255 - t * 215)},${Math.min(boostedAlpha, 1)})`;
      };

      // Form zone bounds (used only for suppressing labels over the form)
      const fzL = panelW + (w - panelW) * 0.05;
      const fzR = w - (w - panelW) * 0.05;
      const fzT = h * 0.12;
      const fzB = h * 0.88;

      // Update positions — slow orbit + drift
      for (const n of nodes) {
        n.angle += n.speed * dt;
        n.x = n.cx + Math.cos(n.angle) * n.orbitR;
        n.y = n.cy + Math.sin(n.angle * 0.7) * n.orbitR * 0.6;
        n.cx += n.vx * 0.015;
        n.cy += n.vy * 0.015;
      }

      // Spawn new labeled nodes over time until MAX_LABELED (never spawn "You")
      if (labeledCountRef.current < MAX_LABELED) {
        spawnTimerRef.current -= dt;
        if (spawnTimerRef.current <= 0) {
          const label = CONTENT_LABELS[Math.floor(Math.random() * CONTENT_LABELS.length)];
          const cx = w * (0.04 + Math.random() * 0.92);
          const cy = h * (0.04 + Math.random() * 0.92);

          nodes.push({
            x: cx, y: cy, cx, cy,
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

      // Connections
      const conns: [number, number][] = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            conns.push([i, j]);
            // Connections involving labeled nodes are slightly brighter
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

      // Spawn pulses — frequent flow of data through the network
      if (conns.length > 0 && pulses.length < MAX_PULSES && Math.random() < 0.015) {
        const [f, t] = conns[Math.floor(Math.random() * conns.length)];
        pulses.push({ from: f, to: t, t: 0, speed: 0.00012 + Math.random() * 0.00018, life: 1 });
      }

      // Draw pulses
      for (let p = pulses.length - 1; p >= 0; p--) {
        const pulse = pulses[p];
        pulse.t += pulse.speed * dt;
        if (pulse.t > 1) pulse.life -= 0.025;
        if (pulse.life <= 0) { pulses.splice(p, 1); continue; }

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

      // Draw nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];

        // If a labeled node is inside the form zone, render as a plain dot (no label/glow)
        const inFormZone = n.x > fzL && n.x < fzR && n.y > fzT && n.y < fzB;

        if (n.label && !inFormZone) {
          // Feature node — glowing dot with label
          const glowPulse = 0.5 + 0.5 * Math.sin((ts * 0.001) + (n.glowPhase ?? 0));
          const isUsers = n.label === 'You';

          if (isUsers) {
            // Users hub — distinct icon: ring + user silhouette
            const ringR = 14 + glowPulse * 3;

            // Outer glow
            const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, ringR + 12);
            glow.addColorStop(0, nc(n.x, 0.15 + glowPulse * 0.08));
            glow.addColorStop(0.6, nc(n.x, 0.04 + glowPulse * 0.03));
            glow.addColorStop(1, nc(n.x, 0));
            ctx.beginPath();
            ctx.arc(n.x, n.y, ringR + 12, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();

            // Ring border
            ctx.beginPath();
            ctx.arc(n.x, n.y, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = nc(n.x, 0.35 + glowPulse * 0.25);
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Filled inner circle
            ctx.beginPath();
            ctx.arc(n.x, n.y, ringR - 3, 0, Math.PI * 2);
            ctx.fillStyle = nc(n.x, 0.08 + glowPulse * 0.04);
            ctx.fill();

            // User silhouette — head
            const iconAlpha = 0.75 + glowPulse * 0.25;
            ctx.beginPath();
            ctx.arc(n.x, n.y - 3, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = nc(n.x, iconAlpha);
            ctx.fill();

            // User silhouette — shoulders
            ctx.beginPath();
            ctx.arc(n.x, n.y + 7, 5.5, Math.PI, 0, false);
            ctx.fillStyle = nc(n.x, iconAlpha);
            ctx.fill();
          } else {
            // Standard feature node — glowing dot
            const haloR = 18 + glowPulse * 4;
            const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, haloR);
            halo.addColorStop(0, nc(n.x, 0.12 + glowPulse * 0.06));
            halo.addColorStop(0.5, nc(n.x, 0.04 + glowPulse * 0.02));
            halo.addColorStop(1, nc(n.x, 0));
            ctx.beginPath();
            ctx.arc(n.x, n.y, haloR, 0, Math.PI * 2);
            ctx.fillStyle = halo;
            ctx.fill();

            // Core dot
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
            ctx.fillStyle = nc(n.x, 0.7 + glowPulse * 0.3);
            ctx.fill();
          }

          // Label text
          const labelY = isUsers ? n.y + 22 : n.y + n.radius + 8;
          ctx.font = `${isUsers ? '600 12px' : '500 11px'} system-ui, -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = nc(n.x, 0.55 + glowPulse * 0.15);
          ctx.fillText(n.label, n.x, labelY);
        } else {
          // Ambient node — small dot
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
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mousedown', onMouseDown);
      cancelAnimationFrame(rafRef.current);
    };
  }, [init]);

  return canvasRef;
}

/**
 * Floating label input with icon support and focus animations.
 */
function AuthInput({
  id,
  label,
  type = 'text',
  value,
  onChange,
  required,
  minLength,
  icon: Icon,
  autoFocus,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
  icon?: React.ComponentType<{ className?: string }>;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const isActive = focused || value.length > 0;

  return (
    <div className="group relative">
      {/* Icon */}
      {Icon && (
        <div
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 z-10 transition-colors duration-200"
          style={focused ? { color: BRAND_ACCENT } : undefined}
        >
          <Icon className={`h-4 w-4 ${!focused ? 'text-muted-foreground' : ''}`} />
        </div>
      )}

      {/* Input */}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        required={required}
        minLength={minLength}
        autoFocus={autoFocus}
        placeholder=""
        className={`
          peer w-full rounded-lg border bg-background
          transition-all duration-200 outline-none
          text-foreground text-sm
          ${Icon ? 'pl-10 pr-4' : 'px-4'}
          pt-5 pb-2
          ${!focused ? 'border-border hover:border-muted-foreground/40' : ''}
        `}
        style={focused ? {
          borderColor: BRAND_ACCENT,
          boxShadow: `0 0 0 2px ${BRAND_ACCENT_RING}, 0 1px 2px 0 rgba(0,0,0,0.05)`,
        } : undefined}
      />

      {/* Floating label */}
      <label
        htmlFor={id}
        className={`
          pointer-events-none absolute transition-all duration-200 select-none
          ${Icon ? 'left-10' : 'left-4'}
          ${isActive
            ? 'top-1.5 text-[11px] font-medium tracking-wide uppercase'
            : 'top-1/2 -translate-y-1/2 text-sm'
          }
          ${!focused ? 'text-muted-foreground' : ''}
        `}
        style={focused ? { color: BRAND_ACCENT } : undefined}
      >
        {label}
      </label>
    </div>
  );
}

/**
 * Brand content for the left panel (logo + tagline).
 */
function BrandContent() {
  return (
    <div className="h-full flex flex-col justify-between px-14 py-14">
      {/* Logo lockup — horizontal, compact */}
      <div
        className="opacity-0"
        style={{ animation: 'auth-slide-up 0.6s ease-out 0.2s forwards' }}
      >
        <div className="flex items-center gap-4">
          <UniffyLogo className="w-12 h-12" variant="dark" />
          <span className="text-white text-3xl font-bold tracking-tight">uniffy</span>
        </div>
      </div>

      {/* Tagline — anchored at bottom, creates vertical tension */}
      <div
        className="opacity-0"
        style={{ animation: 'auth-fade-in 0.8s ease-out 0.6s forwards' }}
      >
        <p className="text-white/50 text-sm font-medium tracking-widest uppercase leading-relaxed">
          Work Infrastructure,<br />
          finally unified.
        </p>
      </div>
    </div>
  );
}

export function AuthForms() {
  useDocumentTitle('Login');
  const canvasRef = useNetworkCanvas();

  // Force light mode on the auth page regardless of user/system theme preference
  useLayoutEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');

    root.classList.remove('dark');

    // Override CSS variables with light theme values (ThemeProvider sets them as inline styles)
    const savedValues: Record<string, string> = {};
    Object.entries(defaultTheme.colors).forEach(([key, value]) => {
      const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
      savedValues[cssVar] = root.style.getPropertyValue(cssVar);
      root.style.setProperty(cssVar, value);
    });

    return () => {
      if (wasDark) root.classList.add('dark');
      Object.entries(savedValues).forEach(([cssVar, value]) => {
        root.style.setProperty(cssVar, value);
      });
    };
  }, []);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((state) => state.auth?.isAuthenticated ?? false);
  const currentOrganizationId = useAppSelector((state) => state.auth?.currentOrganizationId);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      if (currentOrganizationId) {
        navigate('/', { replace: true });
      } else {
        navigate('/select-org', { replace: true });
      }
    }
  }, [isAuthenticated, currentOrganizationId, navigate]);

  // Form fields
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  const fetchUserAndDispatch = async (accessToken: string, refreshToken: string, organizationId?: string, organizationRole?: string, sessionId?: string) => {
    try {
      // Store access token in memory (security: not persisted to localStorage)
      setMemoryAccessToken(accessToken);

      // Create a temporary client with the auth token
      const authenticatedClient = createClient(AuthService, transport);

      const userResponse = await authenticatedClient.getCurrentUser(
        {},
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      const plainUser = {
        id: userResponse.id,
        email: userResponse.email,
        username: userResponse.username,
        fullName: userResponse.fullName,
        isActive: userResponse.isActive,
        isSystemAdmin: userResponse.isSystemAdmin,
        emailVerified: userResponse.emailVerified,
        accentColor: userResponse.accentColor,
        fontFamily: userResponse.fontFamily,
        avatarUrl: userResponse.avatarUrl,
      };

      // Sync theme preferences from user profile
      if (userResponse.accentColor) {
        dispatch(setAccentColor(userResponse.accentColor));
      }
      if (userResponse.fontFamily) {
        dispatch(setFontFamily(userResponse.fontFamily));
      }

      dispatch(setCredentials({
        user: plainUser,
        accessToken,
        refreshToken,
        organizationId,
        organizationRole,
        sessionId,
      }));

    } catch (err: unknown) {
      console.error('Error fetching user details:', err);
      throw new Error('Failed to fetch user details');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await authClient.register({
        email,
        username,
        password,
        fullName: fullName || undefined,
      });

      await fetchUserAndDispatch(response.accessToken, response.refreshToken, response.organizationId, response.organizationRole, response.sessionId);

      // Navigation will be handled by the useEffect above
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Registration failed';
      setError(friendlyErrorMessage(raw) || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await authClient.login({
        email,
        password,
      });

      await fetchUserAndDispatch(response.accessToken, response.refreshToken, response.organizationId, response.organizationRole, response.sessionId);

      // Navigation will be handled by the useEffect above
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Login failed';
      setError(friendlyErrorMessage(raw) || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  // If authenticated, we don't render anything while redirecting
  if (isAuthenticated) {
    return null;
  }

  return (
    <>
      {/* CSS animations */}
      <style>{`
        @keyframes auth-slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes auth-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes auth-spinner {
          to { transform: rotate(360deg); }
        }
        .auth-btn {
          background-color: #09090b;
          color: white;
        }
        .auth-btn:hover:not(:disabled) {
          background-color: #18181b;
        }
        .auth-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>

      <div className="flex min-h-screen relative overflow-hidden">
        {/* Left panel gradient background */}
        <div
          className="hidden lg:block absolute inset-y-0 left-0 w-[52%]"
          style={{ background: 'linear-gradient(160deg, #09090b 0%, #171723 60%, #1a1a2e 100%)' }}
        />
        {/* Right panel background */}
        <div className="absolute inset-y-0 lg:left-[52%] left-0 right-0 bg-background" />

        {/* Full-page network canvas (above backgrounds, below content) */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full z-[1] pointer-events-none hidden lg:block"
        />

        {/* Left — Brand content */}
        <div className="hidden lg:flex lg:w-[52%] relative z-[2] flex-col justify-start">
          <BrandContent />
        </div>

        {/* Right — Form panel */}
        <div className="flex-1 flex flex-col items-center px-6 py-12 sm:px-12 lg:px-20 relative z-[2] pt-[25vh]">
          {/* Mobile logo — only shown on smaller screens */}
          <div className="lg:hidden mb-10 flex items-center gap-3">
            <UniffyLogo className="w-14 h-14" />
            <span className="text-foreground text-xl font-bold tracking-tight">UNIFFY</span>
          </div>

          <div className="w-full max-w-sm">
            {/* Mode switcher — pill toggle */}
            <div
              className="mb-6 opacity-0"
              style={{ animation: 'auth-slide-up 0.5s ease-out 0.2s forwards' }}
            >
              <div className="relative flex bg-muted rounded-lg p-1">
                {/* Sliding indicator */}
                <div
                  className="absolute top-1 bottom-1 rounded-md bg-card shadow-sm border border-border transition-all duration-300 ease-out"
                  style={{
                    left: mode === 'login' ? '4px' : '50%',
                    width: 'calc(50% - 4px)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null); }}
                  className={`relative z-10 flex-1 py-2 text-sm font-medium rounded-md transition-colors duration-200 cursor-pointer ${mode === 'login' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('register'); setError(null); }}
                  className={`relative z-10 flex-1 py-2 text-sm font-medium rounded-md transition-colors duration-200 cursor-pointer ${mode === 'register' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  Register
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div
                className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
                style={{ animation: 'auth-fade-in 0.2s ease-out' }}
              >
                <svg className="h-4 w-4 mt-0.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm.75-10.25a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5zM8 12a1 1 0 100-2 1 1 0 000 2z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Form area with cross-fade */}
            <div
              ref={formRef}
              className="opacity-0"
              style={{ animation: 'auth-slide-up 0.5s ease-out 0.3s forwards' }}
            >
              {mode === 'register' ? (
                <form onSubmit={handleRegister} className="space-y-4">
                  <AuthInput
                    id="reg-email"
                    label="Email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    required
                    icon={Envelope}
                    autoFocus
                  />
                  <AuthInput
                    id="reg-username"
                    label="Username"
                    type="text"
                    value={username}
                    onChange={setUsername}
                    required
                    minLength={3}
                    icon={User}
                  />
                  <AuthInput
                    id="reg-password"
                    label="Password"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    required
                    minLength={8}
                    icon={Lock}
                  />
                  <AuthInput
                    id="reg-fullname"
                    label="Full name (optional)"
                    type="text"
                    value={fullName}
                    onChange={setFullName}
                    icon={IdentificationCard}
                  />

                  <button
                    type="submit"
                    disabled={loading}
                    className="auth-btn w-full mt-2 h-11 text-sm font-semibold tracking-wide rounded-lg cursor-pointer transition-colors duration-200"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4" style={{ animation: 'auth-spinner 0.8s linear infinite' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" opacity="0.3" />
                          <path d="M12 2v4" strokeLinecap="round" />
                        </svg>
                        Creating account...
                      </span>
                    ) : 'Create account'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <AuthInput
                    id="login-email"
                    label="Email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    required
                    icon={Envelope}
                    autoFocus
                  />
                  <AuthInput
                    id="login-password"
                    label="Password"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    required
                    icon={Lock}
                  />

                  <button
                    type="submit"
                    disabled={loading}
                    className="auth-btn w-full mt-2 h-11 text-sm font-semibold tracking-wide rounded-lg cursor-pointer transition-colors duration-200"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4" style={{ animation: 'auth-spinner 0.8s linear infinite' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" opacity="0.3" />
                          <path d="M12 2v4" strokeLinecap="round" />
                        </svg>
                        Signing in...
                      </span>
                    ) : 'Sign in'}
                  </button>
                </form>
              )}
            </div>

            {/* Footer text */}
            <p
              className="mt-8 text-center text-xs text-muted-foreground/60 opacity-0"
              style={{ animation: 'auth-slide-up 0.5s ease-out 0.5s forwards' }}
            >
              By continuing, you agree to the uniffy terms of service.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
