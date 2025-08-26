import express from 'express';
import { z } from 'zod';
import {
  getUserById,
  getRecruiterProfile,
  upsertRecruiterProfile,
  listPublishedJobsByRecruiter,
  getJobById,
  listApplicationsByJob,
  getApplicationDetail,
  updateApplication,
  listInterviewsByApplication,
  createInterview,
  updateInterview,
  // Notifications
  listNotificationsByUser,
  getNotificationById,
  markNotificationRead,
  createNotification,
} from '../db.js';
import { verifyAccessToken } from '../utils/jwt.js';

const router = express.Router();

function parseBearer(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length);
}

function requireRecruiter(req, res, next) {
  try {
    const token = parseBearer(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = verifyAccessToken(token);
    if (!payload || payload.role !== 'RECRUITER') return res.status(403).json({ error: 'Forbidden' });
    req.user = { id: Number(payload.sub), role: payload.role };
    return next();
  } catch (_e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

const ProfilePatchSchema = z.object({
  first_name: z.string().min(1).max(191).optional(),
  last_name: z.string().min(1).max(191).optional(),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  company_name: z.string().min(1).max(191).optional(),
  position: z.string().min(1).max(191).optional(),
  avatar_url: z.string().url().max(512).optional(),
});

// Private: current recruiter's profile (includes private fields)
router.get('/me', requireRecruiter, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user || user.role !== 'RECRUITER') return res.status(403).json({ error: 'Forbidden' });
    const profile = await getRecruiterProfile(req.user.id);
    return res.json({ user, profile });
  } catch (err) {
    console.error('recruiter /me error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Private: update current recruiter's profile
router.patch('/me', requireRecruiter, async (req, res) => {
  try {
    const parsed = ProfilePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }

    // Merge with existing to avoid clearing unspecified fields
    const existing = await getRecruiterProfile(req.user.id);
    const merged = {
      first_name: parsed.data.first_name ?? existing?.first_name ?? null,
      last_name: parsed.data.last_name ?? existing?.last_name ?? null,
      date_of_birth: parsed.data.date_of_birth ?? existing?.date_of_birth ?? null,
      company_name: parsed.data.company_name ?? existing?.company_name ?? null,
      position: parsed.data.position ?? existing?.position ?? null,
      avatar_url: parsed.data.avatar_url ?? existing?.avatar_url ?? null,
    };

    await upsertRecruiterProfile(req.user.id, merged);
    const profile = await getRecruiterProfile(req.user.id);
    return res.json({ ok: true, profile });
  } catch (err) {
    console.error('recruiter patch /me error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Public: list published jobs by recruiter
router.get('/:id/jobs', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });
    const user = await getUserById(id);
    if (!user || user.role !== 'RECRUITER') return res.status(404).json({ error: 'NotFound' });

    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
    const Query = z.object({
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    });
    const parsed = Query.safeParse({ limit, offset });
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }

    const jobs = await listPublishedJobsByRecruiter(id, parsed.data);
    return res.json({ jobs });
  } catch (err) {
    console.error('recruiter /:id/jobs error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Public: recruiter public profile (sanitized)
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });
    const user = await getUserById(id);
    if (!user || user.role !== 'RECRUITER') return res.status(404).json({ error: 'NotFound' });

    const profile = await getRecruiterProfile(id);
    const publicProfile = {
      id: user.id,
      name: user.name,
      first_name: profile?.first_name || null,
      last_name: profile?.last_name || null,
      company_name: profile?.company_name || null,
      position: profile?.position || null,
      avatar_url: profile?.avatar_url || null,
      // date_of_birth, email, phone are private and intentionally omitted
    };
    return res.json({ recruiter: publicProfile });
  } catch (err) {
    console.error('recruiter /:id error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

export default router;

// ---------------- Applications & Interviews (Recruiter) ----------------

const AppStatus = z.enum(['APPLIED', 'PASSED', 'FAILED']);
const InterviewStatus = z.enum(['SCHEDULED', 'COMPLETED', 'CANCELED']);

// List applications for a specific job owned by the recruiter
router.get('/jobs/:id/applications', requireRecruiter, async (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ error: 'InvalidId' });

    const job = await getJobById(jobId);
    if (!job) return res.status(404).json({ error: 'NotFound' });
    if (job.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const Query = z.object({
      status: AppStatus.optional(),
      q: z.string().min(1).max(191).optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    });
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }
    const applications = await listApplicationsByJob(jobId, parsed.data);
    return res.json({ applications });
  } catch (err) {
    console.error('recruiter list job applications error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// View a specific application (must belong to a job owned by the recruiter)
router.get('/applications/:id', requireRecruiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });
    const detail = await getApplicationDetail(id);
    if (!detail) return res.status(404).json({ error: 'NotFound' });
    if (detail.job.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    return res.json(detail);
  } catch (err) {
    console.error('recruiter get application detail error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Update application (status, score, tags, notes)
router.patch('/applications/:id', requireRecruiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });

    const detail = await getApplicationDetail(id);
    if (!detail) return res.status(404).json({ error: 'NotFound' });
    if (detail.job.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const PatchSchema = z.object({
      status: AppStatus.optional(),
      score: z.coerce.number().int().min(0).max(100).optional(),
      tags: z.array(z.string().min(1)).optional(),
      notes: z.string().max(20000).optional(),
    });
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }

    const result = await updateApplication(id, parsed.data);
    if (result.affectedRows === 0) return res.json({ id, application: detail.application });
    const updated = await getApplicationDetail(id);
    return res.json(updated);
  } catch (err) {
    console.error('recruiter patch application error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// List interviews for an application (owned by recruiter)
router.get('/applications/:id/interviews', requireRecruiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });
    const detail = await getApplicationDetail(id);
    if (!detail) return res.status(404).json({ error: 'NotFound' });
    if (detail.job.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const interviews = await listInterviewsByApplication(id);
    return res.json({ interviews });
  } catch (err) {
    console.error('recruiter list interviews error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Create interview for an application (owned by recruiter)
router.post('/applications/:id/interviews', requireRecruiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });
    const detail = await getApplicationDetail(id);
    if (!detail) return res.status(404).json({ error: 'NotFound' });
    if (detail.job.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const CreateSchema = z.object({
      scheduled_at: z.string().min(1),
      duration_minutes: z.coerce.number().int().positive().optional(),
      location: z.string().min(1).max(255).optional(),
      meeting_url: z.string().url().max(512).optional(),
    });
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }
    const { scheduled_at, duration_minutes, location, meeting_url } = parsed.data;
    const { id: newId } = await createInterview({
      application_id: id,
      scheduled_at,
      duration_minutes,
      location,
      meeting_url,
    });
    const path = `${req.baseUrl}/applications/${id}/interviews/${newId}`;
    const host = req.get('x-forwarded-host') ?? req.get('host');
    const protocol = (req.get('x-forwarded-proto') ?? req.protocol) || 'http';
    const url = host ? `${protocol}://${host}${path}` : path;
    // Notify candidate about scheduled interview (fire-and-forget)
    (async () => {
      try {
        const candidateId = detail.application.candidate_id;
        const jobId = detail.job.id;
        await createNotification({
          user_id: candidateId,
          type: 'INTERVIEW',
          title: 'Interview scheduled',
          message: `Your interview for ${detail.job.title} is scheduled at ${scheduled_at}.`,
          data: { job_id: jobId, application_id: id, scheduled_at, path: `/candidate/applications/${id}` },
        });
      } catch (notifyErr) {
        console.error('recruiter create interview notification error', notifyErr);
      }
    })();
    return res.status(201).json({ id: newId, path, url });
  } catch (err) {
    console.error('recruiter create interview error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Update interview (must belong to application owned by recruiter)
router.patch('/applications/:appId/interviews/:intId', requireRecruiter, async (req, res) => {
  try {
    const appId = Number(req.params.appId);
    const intId = Number(req.params.intId);
    if (!Number.isInteger(appId) || appId <= 0 || !Number.isInteger(intId) || intId <= 0) {
      return res.status(400).json({ error: 'InvalidId' });
    }
    const detail = await getApplicationDetail(appId);
    if (!detail) return res.status(404).json({ error: 'NotFound' });
    if (detail.job.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    // Confirm interview belongs to this application
    const interviews = await listInterviewsByApplication(appId);
    const target = interviews.find((i) => Number(i.id) === intId);
    if (!target) return res.status(404).json({ error: 'NotFound' });

    const PatchSchema = z.object({
      scheduled_at: z.string().min(1).optional(),
      duration_minutes: z.coerce.number().int().positive().optional(),
      location: z.string().min(1).max(255).optional().nullable(),
      meeting_url: z.string().url().max(512).optional().nullable(),
      status: InterviewStatus.optional(),
      feedback: z.string().max(20000).optional().nullable(),
      rating: z.coerce.number().int().min(0).max(10).optional(),
    });
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }

    await updateInterview(intId, parsed.data);
    const updated = await listInterviewsByApplication(appId);
    return res.json({ interviews: updated });
  } catch (err) {
    console.error('recruiter patch interview error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// ---- Notifications (Recruiter) ----

// Helper to parse boolean-like values
const Boolish = z.preprocess((v) => {
  if (v === undefined) return undefined;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return v;
}, z.boolean().optional());

// List notifications for current recruiter
router.get('/notifications', requireRecruiter, async (req, res) => {
  try {
    const Query = z.object({
      unread_only: Boolish,
      limit: z.coerce.number().int().positive().max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    });
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }
    const notifications = await listNotificationsByUser(req.user.id, parsed.data);
    return res.json({ notifications });
  } catch (err) {
    console.error('recruiter list notifications error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// View a notification
router.get('/notifications/:id', requireRecruiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });
    const notification = await getNotificationById(id);
    if (!notification) return res.status(404).json({ error: 'NotFound' });
    if (notification.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    return res.json({ notification });
  } catch (err) {
    console.error('recruiter get notification error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Mark as read
router.post('/notifications/:id/read', requireRecruiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });
    const notification = await getNotificationById(id);
    if (!notification) return res.status(404).json({ error: 'NotFound' });
    if (notification.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await markNotificationRead(id);
    const updated = await getNotificationById(id);
    return res.json({ notification: updated });
  } catch (err) {
    console.error('recruiter mark notification read error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});
