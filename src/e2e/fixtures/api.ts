import { createConnectTransport } from '@connectrpc/connect-node';
import { createClient, type Interceptor } from '@connectrpc/connect';
import { AuthService } from '@uniffy/proto/auth/v1/auth_pb';
import { ChatService } from '@uniffy/proto/chat/v1/chat_pb';
import { AgentsService } from '@uniffy/proto/agents/v1/agents_pb';
import { SessionsService } from '@uniffy/proto/agents/v1/sessions_pb';
import { RuntimeService } from '@uniffy/proto/agents/v1/runtime_pb';

const DEFAULT_API_URL = 'http://localhost:8000';

export function apiUrl(): string {
  return process.env.E2E_API_URL ?? DEFAULT_API_URL;
}

function bearer(token: string | undefined): Interceptor | undefined {
  if (!token) return undefined;
  return (next) => (req) => {
    req.header.set('Authorization', `Bearer ${token}`);
    return next(req);
  };
}

function transport(token?: string) {
  const interceptors = [bearer(token)].filter(Boolean) as Interceptor[];
  return createConnectTransport({
    baseUrl: apiUrl(),
    httpVersion: '1.1',
    interceptors,
    useBinaryFormat: false,
  });
}

export function authClient(token?: string) {
  return createClient(AuthService, transport(token));
}

export function chatClient(token: string) {
  return createClient(ChatService, transport(token));
}

export function agentsClient(token: string) {
  return createClient(AgentsService, transport(token));
}

export function sessionsClient(token: string) {
  return createClient(SessionsService, transport(token));
}

export function runtimeClient(token: string) {
  return createClient(RuntimeService, transport(token));
}

export interface LoggedInAuth {
  accessToken: string;
  refreshToken: string;
  userId: string;
  organizationId: string | undefined;
  organizationRole: string | undefined;
  sessionId: string | undefined;
}

export async function loginViaApi(
  email: string,
  password: string,
  organizationSlug?: string,
): Promise<LoggedInAuth> {
  const slug = organizationSlug ?? process.env.E2E_ORG_SLUG ?? undefined;
  const res = await authClient().login({
    email,
    password,
    organizationSlug: slug,
  });
  return {
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    userId: res.userId,
    organizationId: res.organizationId || undefined,
    organizationRole: res.organizationRole || undefined,
    sessionId: res.sessionId || undefined,
  };
}

export interface CurrentUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  isActive: boolean;
  isSystemAdmin: boolean;
  emailVerified: boolean;
  accentColor?: string;
  fontFamily?: string;
  avatarUrl?: string;
}

export async function getCurrentUserViaApi(token: string): Promise<CurrentUser> {
  const res = await authClient(token).getCurrentUser({});
  return {
    id: res.id,
    email: res.email,
    username: res.username,
    fullName: res.fullName ?? '',
    isActive: res.isActive,
    isSystemAdmin: res.isSystemAdmin,
    emailVerified: res.emailVerified,
    accentColor: res.accentColor,
    fontFamily: res.fontFamily,
    avatarUrl: res.avatarUrl,
  };
}
