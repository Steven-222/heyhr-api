import express from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { getUserByEmail, createUser, getUserById, getUserAuthById, updateUserPassword } from '../db.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  refreshCookieOptions,
  REFRESH_COOKIE_NAME,
} from '../utils/jwt.js';

const router = express.Router();

const RoleEnum = z.enum(['RECRUITER', 'CANDIDATE']);

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).optional(),
  phone: z
    .string()
    .min(7)
    .max(20)
    .regex(/^[+0-9\s\-()]+$/i, 'Invalid phone number')
    .optional(),
  role: RoleEnum.default('CANDIDATE'),
});
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const ChangePasswordSchema = z
  .object({
    current_password: z.string().min(1),
    new_password: z.string().min(8, 'Password must be at least 8 characters'),
    repeat_new_password: z.string().min(8),
  })
  .refine((d) => d.new_password === d.repeat_new_password, {
    path: ['repeat_new_password'],
    message: 'Passwords do not match',
  })
  .refine((d) => d.new_password !== d.current_password, {
    path: ['new_password'],
    message: 'New password must be different from current password',
  });

// -------------------- OAuth Helpers --------------------
const SUPPORTED_PROVIDERS = ['google', 'facebook'];
const API_BASE_URL = process.env.API_BASE_URL || '';

function buildProviderAuthUrl(provider, state, callbackUrl) {
  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      include_granted_scopes: 'true',
      state,
      prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  if (provider === 'facebook') {
    const params = new URLSearchParams({
      client_id: process.env.FACEBOOK_CLIENT_ID || '',
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'public_profile,email',
      state,
    });
    // Using v17 graph dialog (works with later as well)
    return `https://www.facebook.com/v17.0/dialog/oauth?${params.toString()}`;
  }
  throw Object.assign(new Error('Unsupported provider'), { status: 400 });
}

async function exchangeCodeForToken(provider, code, callbackUrl) {
  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl,
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) throw Object.assign(new Error('Failed token exchange (google)'), { status: 400, detail: await res.text() });
    return res.json();
  }
  if (provider === 'facebook') {
    const params = new URLSearchParams({
      client_id: process.env.FACEBOOK_CLIENT_ID || '',
      client_secret: process.env.FACEBOOK_CLIENT_SECRET || '',
      code,
      redirect_uri: callbackUrl,
    });
    const url = `https://graph.facebook.com/v17.0/oauth/access_token?${params.toString()}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw Object.assign(new Error('Failed token exchange (facebook)'), { status: 400, detail: await res.text() });
    return res.json();
  }
  throw Object.assign(new Error('Unsupported provider'), { status: 400 });
}

async function fetchUserInfo(provider, tokens) {
  if (provider === 'google') {
    // Prefer userinfo endpoint; id_token could also be decoded, but this ensures fresh profile
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) throw Object.assign(new Error('Failed to fetch google userinfo'), { status: 400, detail: await res.text() });
    const data = await res.json();
    return { email: data.email, name: data.name, provider_id: data.sub };
  }
  if (provider === 'facebook') {
    const params = new URLSearchParams({ access_token: tokens.access_token, fields: 'id,name,email' });
    const res = await fetch(`https://graph.facebook.com/me?${params.toString()}`);
    if (!res.ok) throw Object.assign(new Error('Failed to fetch facebook userinfo'), { status: 400, detail: await res.text() });
    const data = await res.json();
    return { email: data.email, name: data.name, provider_id: data.id };
  }
  throw Object.assign(new Error('Unsupported provider'), { status: 400 });
}

function signInAndSetCookies(res, user) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id, role: user.role });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  return accessToken;
}

function parseBearer(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length);
}

router.post('/register', async (req, res) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }
    const { email, password, name, phone, role } = parsed.data;

    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'EmailTaken', message: 'Email already registered' });
    }

    const password_hash = await hashPassword(password);
    const { id } = await createUser({ email, name: name || null, phone: phone || null, password_hash, role });

    const accessToken = signAccessToken({ sub: id, role });
    const refreshToken = signRefreshToken({ sub: id, role });

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    return res.json({ accessToken, user: { id, email, name: name || null, phone: phone || null, role } });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const user = await getUserByEmail(email);
    // timing-safe-ish delay to avoid easy user existence probing
    if (!user) {
      await new Promise((r) => setTimeout(r, 300));
      return res.status(401).json({ error: 'InvalidCredentials' });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'InvalidCredentials' });

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id, role: user.role });

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    return res.json({
      accessToken,
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const token = parseBearer(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = verifyAccessToken(token);
    const user = await getUserById(Number(payload.sub));
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    return res.json({ user });
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'NoRefreshToken' });
    const payload = verifyRefreshToken(token);
    const user = await getUserById(Number(payload.sub));
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const newRefresh = signRefreshToken({ sub: user.id, role: user.role });
    res.cookie(REFRESH_COOKIE_NAME, newRefresh, refreshCookieOptions());

    return res.json({ accessToken, user });
  } catch (err) {
    return res.status(401).json({ error: 'InvalidRefreshToken' });
  }
});

router.post('/logout', async (_req, res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
  return res.json({ ok: true });
});

router.post('/change-password', async (req, res) => {
  try {
    const token = parseBearer(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }

    const user = await getUserAuthById(Number(payload.sub));
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const ok = await verifyPassword(parsed.data.current_password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'InvalidCurrentPassword' });

    const new_hash = await hashPassword(parsed.data.new_password);
    await updateUserPassword(user.id, new_hash);

    // Invalidate refresh token to force re-login after password change
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('change password error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// -------------------- OAuth Routes --------------------
// Start OAuth flow: GET /auth/oauth/:provider?redirect_uri=...
router.get('/oauth/:provider', async (req, res) => {
  try {
    const provider = String(req.params.provider || '').toLowerCase();
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: 'UnsupportedProvider' });
    }
    const redirect_uri = String(req.query.redirect_uri || '');
    if (!redirect_uri) return res.status(400).json({ error: 'MissingRedirectURI' });

    // Optional role hint from frontend; defaults to CANDIDATE. We accept only valid roles.
    const roleHintRaw = String(req.query.role || '').toUpperCase();
    const roleHint = RoleEnum.options.includes(roleHintRaw) ? roleHintRaw : 'CANDIDATE';

    const callbackUrl = `${API_BASE_URL.replace(/\/$/, '')}/auth/oauth/${provider}/callback`;
    const nonce = crypto.randomBytes(16).toString('hex');
    const statePayload = { n: nonce, r: redirect_uri, ro: roleHint };
    const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
    res.cookie(`oauth_${provider}_nonce`, nonce, { httpOnly: true, sameSite: 'lax', path: `/` });

    const authUrl = buildProviderAuthUrl(provider, state, callbackUrl);
    return res.redirect(authUrl);
  } catch (err) {
    console.error('oauth start error', err);
    const status = err.status || 500;
    return res.status(status).json({ error: 'OAuthStartError', message: err.message || 'Failed to start OAuth' });
  }
});

// OAuth callback: GET /auth/oauth/:provider/callback
router.get('/oauth/:provider/callback', async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'UnsupportedProvider' });
  }
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).json({ error: 'MissingCodeOrState' });

    const decoded = JSON.parse(Buffer.from(String(state), 'base64url').toString());
    const nonceCookie = req.cookies?.[`oauth_${provider}_nonce`];
    if (!nonceCookie || nonceCookie !== decoded.n) {
      return res.status(400).json({ error: 'InvalidState' });
    }
    const redirect_uri = decoded.r;
    if (!redirect_uri) return res.status(400).json({ error: 'MissingRedirectURI' });

    // Determine desired role for new-account creation from state (ro), defaulting to CANDIDATE.
    const desiredRole = (() => {
      try {
        const r = String(decoded.ro || 'CANDIDATE').toUpperCase();
        return RoleEnum.options.includes(r) ? r : 'CANDIDATE';
      } catch {
        return 'CANDIDATE';
      }
    })();

    const callbackUrl = `${API_BASE_URL.replace(/\/$/, '')}/auth/oauth/${provider}/callback`;
    const tokens = await exchangeCodeForToken(provider, String(code), callbackUrl);
    const profile = await fetchUserInfo(provider, tokens);
    if (!profile.email) {
      // Can't proceed without email mapping to account
      const url = new URL(redirect_uri);
      url.searchParams.set('login', 'failed');
      url.searchParams.set('reason', 'no_email');
      res.clearCookie(`oauth_${provider}_nonce`, { path: '/' });
      return res.redirect(url.toString());
    }

    let user = await getUserByEmail(profile.email);
    if (!user) {
      // Create user with random password; default role CANDIDATE
      const randomPass = `oauth:${provider}:${profile.provider_id}:${crypto.randomBytes(8).toString('hex')}`;
      const password_hash = await hashPassword(randomPass);
      const { id } = await createUser({ email: profile.email, name: profile.name || null, phone: null, password_hash, role: desiredRole });
      user = await getUserById(id);
    }

    const accessToken = signInAndSetCookies(res, user);
    res.clearCookie(`oauth_${provider}_nonce`, { path: '/' });

    // Redirect back to app; app can call /auth/refresh to retrieve tokens
    const url = new URL(redirect_uri);
    url.searchParams.set('login', 'success');
    // Optionally include accessToken for immediate use
    url.searchParams.set('accessToken', accessToken);
    return res.redirect(url.toString());
  } catch (err) {
    console.error('oauth callback error', err);
    const urlStr = String(req.query?.state ? (() => {
      try { return JSON.parse(Buffer.from(String(req.query.state), 'base64url').toString()).r || ''; } catch { return ''; }
    })() : '');
    if (urlStr) {
      const url = new URL(urlStr);
      url.searchParams.set('login', 'failed');
      url.searchParams.set('reason', 'exception');
      return res.redirect(url.toString());
    }
    const status = err.status || 500;
    return res.status(status).json({ error: 'OAuthCallbackError', message: err.message || 'OAuth callback failed' });
  }
});

export default router;
