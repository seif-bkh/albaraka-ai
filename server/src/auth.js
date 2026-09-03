/**
 * auth.js — dev-mode identity (JWT HS256 via `jose`).
 *
 * Production: Keycloak is the IdP (deploy/docker-compose.yml + specs/keycloak), the resource
 * server validates RS256 tokens against the realm's JWK endpoint and maps realm roles to the
 * same authority names below. This module provides the same roles for the sandbox preview where
 * Keycloak cannot run. The demo passwords are documented in server/README.md — dev only.
 */
import { SignJWT, jwtVerify } from 'jose';

const USERS = [
  { email: 'admin@albaraka.tn', name: 'Amina Abidi', password: 'Admin#123', roles: ['ADMIN', 'AI_ENGINEER'] },
  { email: 'sharia@albaraka.tn', name: 'Cheikh Mohamed Trabelsi', password: 'Sharia#123', roles: ['SHARIA_OFFICER'] },
  { email: 'compliance@albaraka.tn', name: 'Salma Ben Salah', password: 'Compliance#123', roles: ['COMPLIANCE_OFFICER'] },
  { email: 'reviewer@albaraka.tn', name: 'Yassine Gharbi', password: 'Review#123', roles: ['REVIEWER'] },
  { email: 'agent@albaraka.tn', name: 'Khalil Mansouri', password: 'Agent#123', roles: ['AGENT'] },
];

export async function createToken(user, secret) {
  return new SignJWT({ name: user.name, roles: user.roles, realm_access: { roles: user.roles } })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.email)
    .setIssuer('albaraka-dev-issuer')
    .setAudience('albaraka-ai')
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(new TextEncoder().encode(secret));
}

export async function verifyToken(token, secret) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer: 'albaraka-dev-issuer',
    audience: 'albaraka-ai',
  });
  return { email: payload.sub, name: payload.name, roles: payload.roles || payload.realm_access?.roles || [] };
}

export function login(email, password, secret) {
  const user = USERS.find((u) => u.email === email.toLowerCase().trim());
  if (!user || user.password !== password) return null;
  return user;
}

export function requireAuth(secret) {
  return async (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Bearer token required' } });
    try {
      req.user = await verifyToken(token, secret);
      next();
    } catch {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' } });
    }
  };
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    const has = (req.user?.roles || []).some((r) => roles.includes(r));
    if (!has) return res.status(403).json({ error: { code: 'FORBIDDEN', message: `Requires role: ${roles.join(' | ')}` } });
    next();
  };
}
