import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from "@connectrpc/connect";
import { useNavigate } from 'react-router-dom';
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setCredentials } from "../store/authSlice";
import { setAccentColor, setFontFamily } from "@/theme/themeSlice";
import { transport, setMemoryAccessToken } from "@/config";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  Envelope,
  Lock,
  User,
  IdentificationCard,
} from "@phosphor-icons/react";

const authClient = createClient(AuthService, transport);

// Static brand colors — not from the theme engine so the auth page stays visually consistent
const BRAND_BLUE = 'hsl(221.2, 83.2%, 53.3%)';
const BRAND_BLUE_RING = 'hsla(221.2, 83.2%, 53.3%, 0.2)';

// --- Connected network canvas for the brand panel ---

const FEATURE_LABELS = ['Notes', 'Files', 'Chat', 'Calendar', 'Workflows', 'Assistants', 'You'];
const FEATURE_COUNT = FEATURE_LABELS.length;
const AMBIENT_COUNT = 26;
const CONNECTION_DIST = 280;
const MAX_PULSES = 10;

// Predetermined angular positions for feature nodes (ring with Users at center)
const FEATURE_ANGLES = [
  -0.9,   // Notes — upper-left
  -0.25,  // Files — upper-right
  0.45,   // Chat — right
  1.1,    // Calendar — lower-right
  1.85,   // Workflows — lower-left
  2.55,   // Assistants — left
  0,      // You — center (angle ignored, placed at ring center)
];

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

  const init = useCallback((w: number, h: number) => {
    const nodes: NetNode[] = [];
    const centerX = w * 0.52;
    const centerY = h * 0.55;
    const ringRadius = Math.min(w, h) * 0.24;

    // Place feature nodes — outer ring + Users at center
    for (let i = 0; i < FEATURE_COUNT; i++) {
      const isCenter = FEATURE_LABELS[i] === 'You';
      const cx = isCenter ? centerX : centerX + Math.cos(FEATURE_ANGLES[i]) * ringRadius;
      const cy = isCenter ? centerY : centerY + Math.sin(FEATURE_ANGLES[i]) * ringRadius;
      nodes.push({
        x: cx, y: cy, cx, cy,
        vx: (Math.random() - 0.5) * (isCenter ? 0.04 : 0.12),
        vy: (Math.random() - 0.5) * (isCenter ? 0.04 : 0.12),
        radius: isCenter ? 6 : 4.5,
        angle: Math.random() * Math.PI * 2,
        orbitR: isCenter ? 10 + Math.random() * 8 : 22 + Math.random() * 20,
        speed: 0.0003 + Math.random() * 0.00025,
        label: FEATURE_LABELS[i],
        glowPhase: Math.random() * Math.PI * 2,
      });
    }

    // Exclusion zone: logo + slogan area (top-left)
    const exL = w * 0.04;
    const exR = w * 0.65;
    const exT = h * 0.02;
    const exB = h * 0.22;

    // Place ambient nodes — mix of bridge nodes (between features) and scattered edge nodes
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      let cx: number, cy: number;
      let attempts = 0;

      if (i < 12) {
        // Bridge nodes: placed inside/around the feature ring to connect everything
        do {
          const angle = Math.random() * Math.PI * 2;
          const dist = ringRadius * (0.3 + Math.random() * 0.9);
          cx = centerX + Math.cos(angle) * dist;
          cy = centerY + Math.sin(angle) * dist;
          attempts++;
        } while (
          cx > exL && cx < exR && cy > exT && cy < exB && attempts < 30
        );
      } else {
        // Edge nodes: scattered further out for depth
        do {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.min(w, h) * (0.25 + Math.random() * 0.35);
          cx = centerX + Math.cos(angle) * dist;
          cy = centerY + Math.sin(angle) * dist;
          attempts++;
        } while (
          cx > exL && cx < exR && cy > exT && cy < exB && attempts < 30
        );
      }

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

    // Users node index (last feature node)
    const usersIdx = FEATURE_LABELS.indexOf('You');
    const HIT_RADIUS = 28;

    const getCanvasPos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const isOverUsers = (mx: number, my: number) => {
      const nodes = nodesRef.current;
      if (!nodes[usersIdx]) return false;
      const dx = mx - nodes[usersIdx].x;
      const dy = my - nodes[usersIdx].y;
      return dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS;
    };

    const onMouseDown = (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      if (isOverUsers(pos.x, pos.y)) {
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
        canvas.style.cursor = isOverUsers(pos.x, pos.y) ? 'grab' : '';
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

      // Exclusion zone for logo area (top-left)
      const exL = w * 0.04;
      const exR = w * 0.65;
      const exT = h * 0.02;
      const exB = h * 0.22;
      const exCx = (exL + exR) / 2;
      const exCy = (exT + exB) / 2;

      // Update positions — slow orbit + drift
      for (const n of nodes) {
        n.angle += n.speed * dt;
        n.x = n.cx + Math.cos(n.angle) * n.orbitR;
        n.y = n.cy + Math.sin(n.angle * 0.7) * n.orbitR * 0.6;
        n.cx += n.vx * 0.015;
        n.cy += n.vy * 0.015;

        // Soft repulsion from logo exclusion zone
        if (n.cx > exL && n.cx < exR && n.cy > exT && n.cy < exB) {
          const dx = n.cx - exCx;
          const dy = n.cy - exCy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          n.cx += (dx / dist) * 0.4;
          n.cy += (dy / dist) * 0.4;
        }

        // Bounce off edges
        const m = 50;
        if (n.cx < m) { n.cx = m; n.vx = Math.abs(n.vx); }
        if (n.cx > w - m) { n.cx = w - m; n.vx = -Math.abs(n.vx); }
        if (n.cy < m) { n.cy = m; n.vy = Math.abs(n.vy); }
        if (n.cy > h - m) { n.cy = h - m; n.vy = -Math.abs(n.vy); }
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
            // Connections involving feature nodes are slightly brighter
            const isFeatureConn = i < FEATURE_COUNT || j < FEATURE_COUNT;
            const alpha = (isFeatureConn ? 0.16 : 0.10) * (1 - dist / CONNECTION_DIST);
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
            ctx.lineWidth = isFeatureConn ? 1 : 0.7;
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
        grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(1, `rgba(255,255,255,0)`);
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.9})`;
        ctx.fill();
      }

      // Draw nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];

        if (n.label) {
          // Feature node — glowing dot with label
          const glowPulse = 0.5 + 0.5 * Math.sin((ts * 0.001) + (n.glowPhase ?? 0));
          const isUsers = n.label === 'You';

          if (isUsers) {
            // Users hub — distinct icon: ring + user silhouette
            const ringR = 14 + glowPulse * 3;

            // Outer glow
            const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, ringR + 12);
            glow.addColorStop(0, `rgba(255,255,255,${0.15 + glowPulse * 0.08})`);
            glow.addColorStop(0.6, `rgba(255,255,255,${0.04 + glowPulse * 0.03})`);
            glow.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.beginPath();
            ctx.arc(n.x, n.y, ringR + 12, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();

            // Ring border
            ctx.beginPath();
            ctx.arc(n.x, n.y, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,255,255,${0.35 + glowPulse * 0.25})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Filled inner circle
            ctx.beginPath();
            ctx.arc(n.x, n.y, ringR - 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${0.08 + glowPulse * 0.04})`;
            ctx.fill();

            // User silhouette — head
            const iconAlpha = 0.75 + glowPulse * 0.25;
            ctx.beginPath();
            ctx.arc(n.x, n.y - 3, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${iconAlpha})`;
            ctx.fill();

            // User silhouette — shoulders
            ctx.beginPath();
            ctx.arc(n.x, n.y + 7, 5.5, Math.PI, 0, false);
            ctx.fillStyle = `rgba(255,255,255,${iconAlpha})`;
            ctx.fill();
          } else {
            // Standard feature node — glowing dot
            const haloR = 18 + glowPulse * 4;
            const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, haloR);
            halo.addColorStop(0, `rgba(255,255,255,${0.12 + glowPulse * 0.06})`);
            halo.addColorStop(0.5, `rgba(255,255,255,${0.04 + glowPulse * 0.02})`);
            halo.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.beginPath();
            ctx.arc(n.x, n.y, haloR, 0, Math.PI * 2);
            ctx.fillStyle = halo;
            ctx.fill();

            // Core dot
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${0.7 + glowPulse * 0.3})`;
            ctx.fill();
          }

          // Label text
          const labelY = isUsers ? n.y + 22 : n.y + n.radius + 8;
          ctx.font = `${isUsers ? '600 12px' : '500 11px'} system-ui, -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = `rgba(255,255,255,${0.55 + glowPulse * 0.15})`;
          ctx.fillText(n.label, n.x, labelY);
        } else {
          // Ambient node — small dot
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.2)';
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
          style={focused ? { color: BRAND_BLUE } : undefined}
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
          borderColor: BRAND_BLUE,
          boxShadow: `0 0 0 2px ${BRAND_BLUE_RING}, 0 1px 2px 0 rgba(0,0,0,0.05)`,
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
        style={focused ? { color: BRAND_BLUE } : undefined}
      >
        {label}
      </label>
    </div>
  );
}

/**
 * Left brand panel with animated connected-nodes network background.
 */
function BrandPanel() {
  const canvasRef = useNetworkCanvas();

  return (
    <div
      className="hidden lg:flex lg:w-[52%] relative overflow-hidden flex-col justify-start"
      style={{ backgroundColor: 'hsl(221.2, 83.2%, 53.3%)' }}
    >
      {/* Animated network canvas */}
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Brand content — top-left, logo prominent */}
      <div className="relative z-10 px-14 pt-14">
        {/* Logo mark — large and prominent */}
        <div
          className="mb-5 opacity-0"
          style={{ animation: 'auth-slide-up 0.6s ease-out 0.2s forwards' }}
        >
          <div className="flex items-center gap-4">
            <div className="w-13 h-13 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/10 flex items-center justify-center">
              <span className="text-white font-bold text-2xl tracking-tight">U</span>
            </div>
            <span className="text-white text-4xl font-bold tracking-tight">uniffy</span>
          </div>
        </div>

        {/* Tagline — subordinate to logo */}
        <div
          className="opacity-0"
          style={{ animation: 'auth-slide-up 0.6s ease-out 0.4s forwards' }}
        >
          <p className="text-white/60 text-base font-medium tracking-wide">
            Work Infrastructure for
            < br />
            the rest of us.
          </p>
        </div>
      </div>
    </div>
  );
}

export function AuthForms() {
  useDocumentTitle('Login');
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

  const fetchUserAndDispatch = async (accessToken: string, refreshToken: string, organizationId?: string) => {
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
        organizationId
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

      await fetchUserAndDispatch(response.accessToken, response.refreshToken, response.organizationId);

      // Navigation will be handled by the useEffect above
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
      console.error('Registration error:', err);
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

      await fetchUserAndDispatch(response.accessToken, response.refreshToken, response.organizationId);

      // Navigation will be handled by the useEffect above
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      console.error('Login error:', err);
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
          background-color: hsl(221.2, 83.2%, 53.3%);
          color: white;
        }
        .auth-btn:hover:not(:disabled) {
          background-color: hsl(221.2, 83.2%, 46%);
        }
        .auth-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>

      <div className="flex min-h-screen">
        {/* Left — Brand panel */}
        <BrandPanel />

        {/* Right — Form panel */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 sm:px-12 lg:px-20 bg-background relative">
          {/* Mobile logo — only shown on smaller screens */}
          <div className="lg:hidden mb-10 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: BRAND_BLUE }}>
              <span className="text-white font-bold text-base">U</span>
            </div>
            <span className="text-foreground text-xl font-bold tracking-tight">UNIFFY</span>
          </div>

          <div className="w-full max-w-sm">
            {/* Header */}
            <div
              className="mb-8 opacity-0"
              style={{ animation: 'auth-slide-up 0.5s ease-out 0.1s forwards' }}
            >
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                {mode === 'login' ? 'Welcome back' : 'Create your account'}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {mode === 'login'
                  ? 'Sign in to continue to your workspace.'
                  : 'Get started with your unified workspace.'
                }
              </p>
            </div>

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
