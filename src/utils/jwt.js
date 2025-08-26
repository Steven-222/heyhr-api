import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_SECRET || 'dev_access_secret_change_me';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'dev_refresh_secret_change_me';
const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TTL = process.env.REFRESH_TOKEN_TTL || '7d';

export function signAccessToken({ sub, role }) {
  return jwt.sign({ role, typ: 'access' }, ACCESS_SECRET, {
    subject: String(sub),
    expiresIn: ACCESS_TTL,
  });
}

export function signRefreshToken({ sub, role }) {
  return jwt.sign({ role, typ: 'refresh' }, REFRESH_SECRET, {
    subject: String(sub),
    expiresIn: REFRESH_TTL,
  });
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, ACCESS_SECRET);
  if (payload.typ !== 'access') throw new Error('Invalid token type');
  return payload;
}

export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, REFRESH_SECRET);
  if (payload.typ !== 'refresh') throw new Error('Invalid token type');
  return payload;
}

export const REFRESH_COOKIE_NAME = process.env.COOKIE_NAME || 'heyhr_refresh';

export function refreshCookieOptions() {
  const secure = String(process.env.COOKIE_SECURE || 'false') === 'true';
  const domain = process.env.COOKIE_DOMAIN || undefined;
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure,
    domain,
  };
}
