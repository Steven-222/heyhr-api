import express from 'express';
import { z } from 'zod';
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

export default router;
