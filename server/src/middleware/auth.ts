import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

// Supabase signs access tokens with asymmetric keys (ES256). We verify them
// locally against the project's public JWKS — no per-request network call once
// the key set is cached.
type JWKSet = ReturnType<typeof createRemoteJWKSet>;
let jwks: JWKSet | null = null;

function getJWKS(): JWKSet {
  if (!jwks) {
    const url = process.env.SUPABASE_URL;
    if (!url) throw new Error('SUPABASE_URL is not set');
    jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

/** Reject the request unless it carries a valid Supabase access token. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: `${process.env.SUPABASE_URL}/auth/v1`,
    });
    req.userId = payload.sub;
    req.userEmail = (payload as JWTPayload & { email?: string }).email ?? null;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
