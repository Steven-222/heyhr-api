import express from 'express';
import { z } from 'zod';
import { verifyAccessToken } from '../utils/jwt.js';
import { 
  createJob, 
  getJobById, 
  updateJob, 
  listJobsByRecruiter, 
  deleteJob, 
  createNotification,
  closeJob,
  reopenJob,
} from '../db.js';
import multer from 'multer';
import { extractJobFieldsFromPdf } from '../utils/pdf.js';

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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

const JobType = z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY', 'FREELANCE']);

const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .nullable();

const SkillItem = z.object({
  name: z.string().min(1),
  weight: z.number().int().min(0).max(100),
});

const JobCreateSchema = z.object({
  title: z.string().min(1),
  company_name: z.string().min(1).optional().nullable(),
  location: z.string().min(1).optional().nullable(),
  remote_flexible: z.boolean().optional().default(false),
  job_type: JobType.optional().nullable(),
  salary: z.number().int().nonnegative().optional().nullable(),
  interview_duration: z.number().int().nonnegative().optional().nullable(),
  commencement_date: DateStr,
  intro: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  responsibilities: z.array(z.string()).optional().nullable(),
  requirements: z.array(z.string()).optional().nullable(),
  qualifications: z.array(z.string()).optional().nullable(),
  other_details: z.record(z.any()).optional().nullable(),
  skills_soft: z.array(SkillItem).optional().nullable(),
  skills_technical: z.array(SkillItem).optional().nullable(),
  skills_cognitive: z.array(SkillItem).optional().nullable(),
  hiring_start_date: DateStr,
  hiring_end_date: DateStr,
  application_start_date: DateStr,
  application_end_date: DateStr,
  position_close_date: DateStr,
  allow_international: z.boolean().optional().default(false),
  shortlist: z.boolean().optional().default(false),
  auto_offer: z.boolean().optional().default(false),
  // Require explicit status on create: only DRAFT or PUBLISHED allowed at creation time
  status: z.enum(['DRAFT', 'PUBLISHED']),
});

// All fields optional for draft updates
const JobUpdateDraftSchema = z.object({
  title: z.string().min(1).optional(),
  company_name: z.string().min(1).optional().nullable(),
  location: z.string().min(1).optional().nullable(),
  remote_flexible: z.boolean().optional(),
  job_type: JobType.optional().nullable(),
  salary: z.number().int().nonnegative().optional().nullable(),
  interview_duration: z.number().int().nonnegative().optional().nullable(),
  commencement_date: DateStr,
  intro: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  responsibilities: z.array(z.string()).optional().nullable(),
  requirements: z.array(z.string()).optional().nullable(),
  qualifications: z.array(z.string()).optional().nullable(),
  other_details: z.record(z.any()).optional().nullable(),
  skills_soft: z.array(SkillItem).optional().nullable(),
  skills_technical: z.array(SkillItem).optional().nullable(),
  skills_cognitive: z.array(SkillItem).optional().nullable(),
  hiring_start_date: DateStr,
  hiring_end_date: DateStr,
  application_start_date: DateStr,
  application_end_date: DateStr,
  position_close_date: DateStr,
  allow_international: z.boolean().optional(),
  shortlist: z.boolean().optional(),
  auto_offer: z.boolean().optional(),
  // status is intentionally omitted here; use a publish endpoint to change it
});

// Upload a job description PDF and auto-extract suggested job fields
router.post('/autofill', requireRecruiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'BadRequest', message: 'file is required' });
    }
    const isPdf = (req.file.mimetype && req.file.mimetype.includes('pdf')) || (req.file.originalname && /\.pdf$/i.test(req.file.originalname));
    if (!isPdf) {
      return res.status(400).json({ error: 'UnsupportedMediaType', message: 'Only PDF files are supported' });
    }
    const suggested = await extractJobFieldsFromPdf(req.file.buffer);
    return res.json({ suggested });
  } catch (err) {
    console.error('autofill job from pdf error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Failed to extract job info from PDF' });
  }
});

router.post('/', requireRecruiter, async (req, res) => {
  try {
    // coerce numeric fields from strings if any
    const body = {
      ...req.body,
      salary: req.body.salary !== undefined ? Number(req.body.salary) : undefined,
      interview_duration: req.body.interview_duration !== undefined ? Number(req.body.interview_duration) : undefined,
      // backward compatibility: accept old auto_close and map to auto_offer
      auto_offer: req.body.auto_offer ?? req.body.auto_close,
      skills_soft: Array.isArray(req.body.skills_soft)
        ? req.body.skills_soft.map((s) => ({ ...s, weight: s?.weight !== undefined ? Number(s.weight) : s?.weight }))
        : req.body.skills_soft,
      skills_technical: Array.isArray(req.body.skills_technical)
        ? req.body.skills_technical.map((s) => ({ ...s, weight: s?.weight !== undefined ? Number(s.weight) : s?.weight }))
        : req.body.skills_technical,
      skills_cognitive: Array.isArray(req.body.skills_cognitive)
        ? req.body.skills_cognitive.map((s) => ({ ...s, weight: s?.weight !== undefined ? Number(s.weight) : s?.weight }))
        : req.body.skills_cognitive,
    };
    const parsed = JobCreateSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }

    const data = parsed.data;
    const { id } = await createJob({
      ...data,
      recruiter_id: req.user.id,
    });
    const job = await getJobById(id);
    const path = `${req.baseUrl}/${id}`;
    const host = req.get('x-forwarded-host') ?? req.get('host');
    const protocol = (req.get('x-forwarded-proto') ?? req.protocol) || 'http';
    const url = host ? `${protocol}://${host}${path}` : path;
    // Fire-and-forget notification if created as PUBLISHED
    (async () => {
      try {
        if (job?.status === 'PUBLISHED') {
          await createNotification({
            user_id: req.user.id,
            type: 'JOB',
            title: 'Job published',
            message: `Your job "${job.title}" was approved and published.`,
            data: { job_id: id, path },
          });
        }
      } catch (notifyErr) {
        console.error('jobs create publish notification error', notifyErr);
      }
    })();
    return res.status(201).json({ id, job, path, url });
  } catch (err) {
    console.error('create job error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// List jobs created by the authenticated recruiter
router.get('/', requireRecruiter, async (req, res) => {
  try {
    const body = {
      status: req.query.status,
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      offset: req.query.offset !== undefined ? Number(req.query.offset) : undefined,
    };
    const ListQuerySchema = z.object({
      status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    });
    const parsed = ListQuerySchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
    }
    const jobs = await listJobsByRecruiter(req.user.id, parsed.data);
    return res.json({ jobs });
  } catch (err) {
    console.error('list jobs error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Update job (partial). Status can be updated regardless of current status.
router.patch('/:id', requireRecruiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });

    const current = await getJobById(id);
    if (!current) return res.status(404).json({ error: 'NotFound' });
    if (current.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    
    // Handle status updates separately since they're not in the schema
    let statusUpdate = null;
    if (req.body.status !== undefined) {
      // Validate status value
      if (!['DRAFT', 'PUBLISHED'].includes(req.body.status)) {
        return res.status(400).json({ error: 'ValidationError', message: 'Invalid status value' });
      }
      statusUpdate = req.body.status;
    }
    
    // For non-draft jobs, only allow status updates
    if (current.status !== 'DRAFT' && Object.keys(req.body).some(key => key !== 'status')) {
      return res.status(409).json({ error: 'NotDraft', message: 'Only status can be updated for non-draft jobs' });
    }

    // Prepare data for update
    let updateData = {};
    
    // If we're only updating status
    if (statusUpdate && Object.keys(req.body).length === 1) {
      updateData = { status: statusUpdate };
    } 
    // If we're updating other fields (with or without status)
    else {
      // Remove status from body for schema validation
      const { status, ...bodyWithoutStatus } = req.body;
      
      // Coerce numeric fields and skill weights similar to create
      const body = {
        ...bodyWithoutStatus,
        salary: bodyWithoutStatus.salary !== undefined ? Number(bodyWithoutStatus.salary) : undefined,
        interview_duration: bodyWithoutStatus.interview_duration !== undefined ? Number(bodyWithoutStatus.interview_duration) : undefined,
        // backward compatibility: accept old auto_close and map to auto_offer
        auto_offer: bodyWithoutStatus.auto_offer ?? bodyWithoutStatus.auto_close,
        skills_soft: Array.isArray(bodyWithoutStatus.skills_soft)
          ? bodyWithoutStatus.skills_soft.map((s) => ({ ...s, weight: s?.weight !== undefined ? Number(s.weight) : s?.weight }))
          : bodyWithoutStatus.skills_soft,
        skills_technical: Array.isArray(bodyWithoutStatus.skills_technical)
          ? bodyWithoutStatus.skills_technical.map((s) => ({ ...s, weight: s?.weight !== undefined ? Number(s.weight) : s?.weight }))
          : bodyWithoutStatus.skills_technical,
        skills_cognitive: Array.isArray(bodyWithoutStatus.skills_cognitive)
          ? bodyWithoutStatus.skills_cognitive.map((s) => ({ ...s, weight: s?.weight !== undefined ? Number(s.weight) : s?.weight }))
          : bodyWithoutStatus.skills_cognitive,
      };

      const parsed = JobUpdateDraftSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'ValidationError', issues: parsed.error.flatten() });
      }

      updateData = parsed.data;
      
      // Add status back if it was provided
      if (statusUpdate) {
        updateData.status = statusUpdate;
      }
    }

    const result = await updateJob(id, updateData);
    if (result.affectedRows === 0) return res.status(200).json({ id, job: current });
    const job = await getJobById(id);
    return res.json({ id, job });
  } catch (err) {
    console.error('update draft job error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Publish a draft job (transition to PUBLISHED)
router.post('/:id/publish', requireRecruiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });

    const current = await getJobById(id);
    if (!current) return res.status(404).json({ error: 'NotFound' });
    if (current.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (current.status === 'PUBLISHED') {
      return res.json({ id, job: current });
    }
    if (current.status !== 'DRAFT') {
      return res.status(409).json({ error: 'NotDraft', message: 'Only drafts can be published' });
    }

    await updateJob(id, { status: 'PUBLISHED' });
    const job = await getJobById(id);
    const path = `${req.baseUrl}/${id}`;

    // Notify recruiter about approval/publish (fire-and-forget)
    (async () => {
      try {
        await createNotification({
          user_id: req.user.id,
          type: 'JOB',
          title: 'Job published',
          message: `Your job "${job.title}" was approved and published.`,
          data: { job_id: id, path },
        });
      } catch (notifyErr) {
        console.error('jobs publish notification error', notifyErr);
      }
    })();

    return res.json({ id, job });
  } catch (err) {
    console.error('publish job error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Close a job
router.post('/:id/close', requireRecruiter, async (req, res) => {
  try {
    const { id } = req.params;
    const job = await getJobById(id);
    if (!job) {
      return res.status(404).json({ error: 'NotFound', message: 'Job not found' });
    }
    if (job.recruiter_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden', message: 'You do not own this job' });
    }
    if (job.status !== 'PUBLISHED') {
      return res.status(400).json({ error: 'BadRequest', message: 'Only PUBLISHED jobs can be closed' });
    }
    await closeJob(id);
    return res.status(204).send();
  } catch (err) {
    console.error('close job error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Re-open a job
router.post('/:id/reopen', requireRecruiter, async (req, res) => {
  try {
    const { id } = req.params;
    const job = await getJobById(id);
    if (!job) {
      return res.status(404).json({ error: 'NotFound', message: 'Job not found' });
    }
    if (job.recruiter_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden', message: 'You do not own this job' });
    }
    if (job.status !== 'DRAFT') {
      return res.status(400).json({ error: 'BadRequest', message: 'Only DRAFT jobs can be re-opened' });
    }
    await reopenJob(id);
    return res.status(204).send();
  } catch (err) {
    console.error('reopen job error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

// Delete a job (any status)
router.delete('/:id', requireRecruiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });

    const current = await getJobById(id);
    if (!current) return res.status(404).json({ error: 'NotFound' });
    if (current.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    // Removed status restriction to allow deleting jobs of any status

    await deleteJob(id);
    return res.status(204).end();
  } catch (err) {
    console.error('delete job error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'InvalidId' });
    const job = await getJobById(id);
    if (!job) return res.status(404).json({ error: 'NotFound' });
    return res.json({ job });
  } catch (err) {
    console.error('get job error', err);
    return res.status(500).json({ error: 'ServerError', message: 'Unexpected error' });
  }
});

export default router;
