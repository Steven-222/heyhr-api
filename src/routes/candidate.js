import express from 'express';
import { z } from 'zod';
import {
  listPublishedJobs,
  getJobById,
  getUserById,
  getCandidateProfile,
  upsertCandidateProfile,
  updateUserFields,
  createApplication,
  listApplicationsByCandidate,
  getApplicationDetail,
  // Notifications
  listNotificationsByUser,
  getNotificationById,
  markNotificationRead,
  createNotification,
  countApplicationsByJob,
  listApplicationsByJob,
} from '../db.js';
import { verifyAccessToken } from '../utils/jwt.js';

const router = express.Router();

function parseBearer(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length);
}

function requireCandidate(req, res, next) {
  try {
    const token = parseBearer(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = verifyAccessToken(token);
    if (!payload || payload.role !== 'CANDIDATE') return res.status(403).json({ error: 'Forbidden' });
    req.user = { id: Number(payload.sub), role: payload.role };
    return next();
  } catch (_e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const EducationItem = z.object({
  degree: z.string().min(1),
  institution: z.string().min(1),
  graduation_year: z.number().int().min(1900).max(2100).optional().nullable(),
});

const ExperienceItem = z.object({
  position: z.string().min(1),
  company: z.string().min(1),
  duration: z.string().optional().nullable(),
  responsibilities: z.string().optional().nullable(),
});

const CandidateProfilePatchSchema = z.object({
  first_name: z.string().min(1).max(191).optional(),
  last_name: z.string().min(1).max(191).optional(),
  date_of_birth: DateStr,
  avatar_url: z.string().url().max(512).optional(),
  resume_url: z.string().url().max(512).optional(),
  career_objective: z.string().max(5000).optional(),
  education: z.array(EducationItem).optional(),
  experience: z.array(ExperienceItem).optional(),
  // allow updating some user fields alongside
  name: z.string().min(1).max(191).optional(),
  phone: z.string().min(6).max(32).optional(),
});

// Private: current candidate profile (includes private fields)
router.get('/me', requireCandidate, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user || user.role !== 'CANDIDATE') return res.status(403).json({ error: 'Forbidden' });
    const profile = await getCandidateProfile(req.user.id);
    return res.json({ user, profile });
  } catch (err) {
    console.error('candidate /me error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Private: update current candidate profile
router.patch('/me', requireCandidate, async (req, res) => {
  try {
    const parsed = CandidateProfilePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }

    const existing = await getCandidateProfile(req.user.id);
    const data = parsed.data;
    const merged = {
      first_name: Object.prototype.hasOwnProperty.call(data, 'first_name') ? data.first_name ?? null : existing?.first_name ?? null,
      last_name: Object.prototype.hasOwnProperty.call(data, 'last_name') ? data.last_name ?? null : existing?.last_name ?? null,
      date_of_birth: Object.prototype.hasOwnProperty.call(data, 'date_of_birth') ? data.date_of_birth ?? null : existing?.date_of_birth ?? null,
      avatar_url: Object.prototype.hasOwnProperty.call(data, 'avatar_url') ? data.avatar_url ?? null : existing?.avatar_url ?? null,
      resume_url: Object.prototype.hasOwnProperty.call(data, 'resume_url') ? data.resume_url ?? null : existing?.resume_url ?? null,
      career_objective: Object.prototype.hasOwnProperty.call(data, 'career_objective') ? data.career_objective ?? null : existing?.career_objective ?? null,
      education: Object.prototype.hasOwnProperty.call(data, 'education') ? data.education ?? null : existing?.education ?? null,
      experience: Object.prototype.hasOwnProperty.call(data, 'experience') ? data.experience ?? null : existing?.experience ?? null,
    };

    await upsertCandidateProfile(req.user.id, merged);

    // Update user fields if provided
    const userPatch = {};
    if (Object.prototype.hasOwnProperty.call(data, 'name')) userPatch.name = data.name ?? null;
    if (Object.prototype.hasOwnProperty.call(data, 'phone')) userPatch.phone = data.phone ?? null;
    if (Object.keys(userPatch).length > 0) await updateUserFields(req.user.id, userPatch);

    const user = await getUserById(req.user.id);
    const profile = await getCandidateProfile(req.user.id);
    return res.json({ ok: true, user, profile });
  } catch (err) {
    console.error('candidate patch /me error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// List published jobs (public)
router.get('/jobs', async (req, res) => {
  try {
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
    if ((limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > 200)) ||
        (offset !== undefined && (!Number.isInteger(offset) || offset < 0))) {
      return res.status(400).json({ error: 'ValidationError', message: 'Invalid pagination parameters' });
    }
    const jobs = await listPublishedJobs({ limit, offset });
    return res.json({ jobs });
  } catch (err) {
    console.error('candidate list jobs error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Get a published job by ID (public)
router.get('/jobs/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });

    const job = await getJobById(id);
    if (!job || job.status !== 'PUBLISHED') return res.status(404).json({ error: 'NotFound' });
    return res.json({ job });
  } catch (err) {
    console.error('candidate get job error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// ---- Applications ----

const AppStatus = z.enum(['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']);

const ApplySchema = z.object({
  job_id: z.number().int().positive(),
  resume_url: z.string().url().max(512).optional(),
  cover_letter: z.string().max(10000).optional(),
  // Source is system-controlled for candidate apply
  source: z.literal('APPLY').optional(),
});

// Candidate applies to a published job
router.post('/applications', requireCandidate, async (req, res) => {
  try {
    const parsed = ApplySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }
    const { job_id, resume_url, cover_letter } = parsed.data;

    const job = await getJobById(job_id);
    if (!job || job.status !== 'PUBLISHED') return res.status(404).json({ error: 'NotFound' });

    try {
      const { id } = await createApplication({
        job_id,
        candidate_id: req.user.id,
        source: 'APPLY',
        resume_url,
        cover_letter,
      });
      const path = `${req.baseUrl}/applications/${id}`;
      const url = `${req.protocol}://${req.get('host')}${path}`;
      // Fire-and-forget notifications (do not block response)
      (async () => {
        try {
          const tasks = [];
          // Candidate confirmation
          tasks.push(
            createNotification({
              user_id: req.user.id,
              type: 'APPLICATION',
              title: 'Application received',
              message: `Your application to ${job.title} was received.`,
              data: { job_id, application_id: id, path: `/candidate/applications/${id}` },
            })
          );
          // Recruiter notification
          if (job.recruiter_id) {
            // Include dynamic count of applications for this job, fallback to generic message on error
            let msg;
            try {
              const total = await countApplicationsByJob(job.id);
              if (Number.isFinite(total)) {
                msg = `You’ve got ${total} new applicants for the ${job.title} position. Tap here to review them now.`;
              }
            } catch {}
            if (!msg) {
              msg = `You’ve got new applicants for the ${job.title} position. Tap here to review them now.`;
            }
            // Include a compact list of recent applicants to display in notification detail
            let recent_applicants = [];
            try {
              const recent = await listApplicationsByJob(job.id, { limit: 5 });
              recent_applicants = recent.map((a) => ({
                application_id: a.id,
                applied_at: a.created_at,
                candidate_id: a.candidate?.id ?? a.candidate_id,
                candidate_email: a.candidate?.email ?? null,
                candidate_name: a.candidate?.name || [a.profile?.first_name, a.profile?.last_name].filter(Boolean).join(' ') || null,
                avatar_url: a.profile?.avatar_url ?? null,
              }));
            } catch {}
            tasks.push(
              createNotification({
                user_id: job.recruiter_id,
                type: 'APPLICATION',
                title: 'New application',
                message: msg,
                data: { job_id, application_id: id, candidate_id: req.user.id, path: `/recruiter/jobs/${job.id}/applications`, recent_applicants },
              })
            );
          }
          await Promise.allSettled(tasks);
        } catch (notifyErr) {
          console.error('candidate apply notifications error', notifyErr);
        }
      })();
      return res.status(201).json({ id, path, url });
    } catch (e) {
      if (e && (e.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(e.sqlMessage || ''))) {
        return res.status(409).json({ error: 'AlreadyApplied', message: 'You have already applied to this job.' });
      }
      console.error('candidate apply error', e);
      return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
    }
  } catch (err) {
    console.error('candidate post /applications error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// List applications for the current candidate
router.get('/applications', requireCandidate, async (req, res) => {
  try {
    const Query = z.object({
      status: AppStatus.optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    });
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }
    const applications = await listApplicationsByCandidate(req.user.id, parsed.data);
    return res.json({ applications });
  } catch (err) {
    console.error('candidate list applications error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// View an application detail (owned by the current candidate)
router.get('/applications/:id', requireCandidate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });
    const detail = await getApplicationDetail(id);
    if (!detail) return res.status(404).json({ error: 'NotFound' });
    if (detail.application.candidate_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    return res.json(detail);
  } catch (err) {
    console.error('candidate get application detail error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// ---- Notifications ----

// Helper: parse boolean-like query values
const Boolish = z.preprocess((v) => {
  if (v === undefined) return undefined;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return v;
}, z.boolean().optional());

// List notifications for the current candidate
router.get('/notifications', requireCandidate, async (req, res) => {
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
    console.error('candidate list notifications error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// View a notification (must belong to current candidate)
router.get('/notifications/:id', requireCandidate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });
    const notification = await getNotificationById(id);
    if (!notification) return res.status(404).json({ error: 'NotFound' });
    if (notification.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    return res.json({ notification });
  } catch (err) {
    console.error('candidate get notification error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Mark a notification as read
router.post('/notifications/:id/read', requireCandidate, async (req, res) => {
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
    console.error('candidate mark notification read error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

export default router;
