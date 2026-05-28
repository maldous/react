export const packageName = "@platform/session-runtime";

// Session record stored in Redis
export interface SessionRecord {
  sessionId: string;
  userId: string;
  tenantId: string;
  organisationId: string;
  roles: string[];
  permissions: string[];
  displayName: string;
  expiresAt: Date;
  createdAt: Date;
}

// Commands for session lifecycle
export interface CreateSessionCommand {
  userId: string;
  tenantId: string;
  organisationId: string;
  roles: string[];
  permissions: string[];
  displayName: string;
  ttlSeconds: number;
}

export interface SessionStore {
  create(command: CreateSessionCommand): Promise<string>; // returns sessionId
  find(sessionId: string): Promise<SessionRecord | null>;
  refresh(sessionId: string, ttlSeconds: number): Promise<void>;
  destroy(sessionId: string): Promise<void>;
}

// Cookie configuration
export const SESSION_COOKIE_NAME = "platform_session";
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
} as const;
