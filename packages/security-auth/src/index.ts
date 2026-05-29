export const packageName = "@platform/security-auth";

export class SecurityError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "SecurityError";
    this.code = code;
  }
}

export interface TokenClaims {
  sub: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

export type TokenValidationResult =
  | { valid: true; claims: TokenClaims }
  | { valid: false; reason: string };

export interface AuthPort {
  validateToken(token: string, options?: { audience?: string }): Promise<TokenValidationResult>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}

export interface RateLimitPort {
  check(
    key: string,
    options?: { limit?: number; windowSeconds?: number }
  ): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

export function createNoopAuthPort(): AuthPort {
  return {
    async validateToken() {
      return { valid: false, reason: "noop auth port — no validation configured" };
    },
  };
}

export function createNoopRateLimitPort(): RateLimitPort {
  return {
    async check(_, options) {
      const limit = options?.limit ?? 1000;
      return { allowed: true, remaining: limit, resetAt: new Date(Date.now() + 60_000), limit };
    },
    async reset() {},
  };
}
