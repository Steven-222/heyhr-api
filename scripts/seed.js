import 'dotenv/config';
import {
  initDB,
  pool,
  getUserByEmail,
  createUser,
  upsertRecruiterProfile,
  upsertCandidateProfile,
  createJob,
  createApplication,
  createInterview,
  createNotification,
} from '../src/db.js';
import { hashPassword } from '../src/utils/password.js';

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || 'Passw0rd!';

async function ensureUser({ email, name, phone, role, profile }) {
  const existing = await getUserByEmail(email);
  if (existing) {
    console.log(`User exists: ${email} (id=${existing.id})`);
    if (profile?.type === 'recruiter') await upsertRecruiterProfile(existing.id, profile.data);
    if (profile?.type === 'candidate') await upsertCandidateProfile(existing.id, profile.data);
    return existing.id;
  }
  const password_hash = await hashPassword(DEFAULT_PASSWORD);
  const { id } = await createUser({ email, name, phone, password_hash, role });
  console.log(`Created user: ${email} (id=${id}, role=${role})`);
  if (profile?.type === 'recruiter') await upsertRecruiterProfile(id, profile.data);
  if (profile?.type === 'candidate') await upsertCandidateProfile(id, profile.data);
  return id;
}

async function ensureJob(recruiter_id, job) {
  const [rows] = await pool.query(
    'SELECT id FROM jobs WHERE recruiter_id = :recruiter_id AND title = :title LIMIT 1',
    { recruiter_id, title: job.title }
  );
  if (rows[0]) {
    console.log(`Job exists: ${job.title} (id=${rows[0].id})`);
    return rows[0].id;
  }
  const { id } = await createJob({ recruiter_id, ...job });
  console.log(`Created job: ${job.title} (id=${id})`);
  return id;
}

async function ensureApplication(job_id, candidate_id, data = {}) {
  const [rows] = await pool.query(
    'SELECT id FROM applications WHERE job_id = :job_id AND candidate_id = :candidate_id LIMIT 1',
    { job_id, candidate_id }
  );
  if (rows[0]) {
    console.log(`Application exists: job ${job_id} / candidate ${candidate_id} (id=${rows[0].id})`);
    return rows[0].id;
  }
  const { id } = await createApplication({ job_id, candidate_id, ...data });
  console.log(`Created application: id=${id} (job ${job_id}, candidate ${candidate_id})`);
  return id;
}

async function ensureInterview(application_id, scheduled_at, data = {}) {
  const [rows] = await pool.query(
    'SELECT id FROM interviews WHERE application_id = :application_id AND scheduled_at = :scheduled_at LIMIT 1',
    { application_id, scheduled_at }
  );
  if (rows[0]) {
    console.log(`Interview exists: app ${application_id} @ ${scheduled_at} (id=${rows[0].id})`);
    return rows[0].id;
  }
  const { id } = await createInterview({ application_id, scheduled_at, ...data });
  console.log(`Created interview: id=${id} (app ${application_id})`);
  return id;
}

// Ensure a notification exists (idempotent by user_id + title + type + message)
async function ensureNotification(user_id, notif) {
  const [rows] = await pool.query(
    'SELECT id FROM notifications WHERE user_id = :user_id AND title = :title AND type <=> :type AND message <=> :message LIMIT 1',
    { user_id, title: notif.title, type: notif.type ?? null, message: notif.message ?? null }
  );
  if (rows[0]) {
    console.log(`Notification exists: user ${user_id} "${notif.title}" (id=${rows[0].id})`);
    return rows[0].id;
  }
  const { id } = await createNotification({
    user_id,
    type: notif.type,
    title: notif.title,
    message: notif.message,
    data: notif.data,
  });
  console.log(`Created notification: id=${id} for user ${user_id} (${notif.title})`);
  return id;
}

async function main() {
  await initDB();

  // Recruiters
  const rec1 = await ensureUser({
    email: 'rec1@heyhr.test',
    name: 'Recruiter One',
    phone: '+1-555-1001',
    role: 'RECRUITER',
    profile: {
      type: 'recruiter',
      data: { first_name: 'Alex', last_name: 'Morgan', company_name: 'Acme Corp', position: 'Talent Lead', avatar_url: null },
    },
  });

  const rec2 = await ensureUser({
    email: 'rec2@heyhr.test',
    name: 'Recruiter Two',
    phone: '+1-555-1002',
    role: 'RECRUITER',
    profile: {
      type: 'recruiter',
      data: { first_name: 'Sam', last_name: 'Lee', company_name: 'Globex Inc', position: 'HR Manager', avatar_url: null },
    },
  });

  // Candidates
  const cand1 = await ensureUser({
    email: 'cand1@heyhr.test',
    name: 'Candidate One',
    phone: '+1-555-2001',
    role: 'CANDIDATE',
    profile: {
      type: 'candidate',
      data: {
        first_name: 'Jordan',
        last_name: 'Kim',
        resume_url: 'https://example.com/resumes/jordan_kim.pdf',
        career_objective: 'Build impactful software.',
        education: [{ school: 'State University', degree: 'BSc CS', year: 2022 }],
        experience: [{ company: 'StartCo', role: 'Intern', from: '2021-06', to: '2021-08' }],
      },
    },
  });

  const cand2 = await ensureUser({
    email: 'cand2@heyhr.test',
    name: 'Candidate Two',
    phone: '+1-555-2002',
    role: 'CANDIDATE',
    profile: {
      type: 'candidate',
      data: {
        first_name: 'Taylor',
        last_name: 'Nguyen',
        resume_url: 'https://example.com/resumes/taylor_nguyen.pdf',
        career_objective: 'Data-driven decision making.',
        education: [{ school: 'Tech Institute', degree: 'MSc Data Science', year: 2023 }],
        experience: [{ company: 'DataWorks', role: 'Analyst', from: '2023-01', to: '2024-01' }],
      },
    },
  });

  // Jobs
  const job1 = await ensureJob(rec1, {
    title: 'Software Engineer',
    company_name: 'Acme Corp',
    location: 'Remote',
    remote_flexible: true,
    job_type: 'FULL_TIME',
    salary: 120000,
    intro: 'Join our core platform team.',
    description: 'Work on APIs, databases, and cloud.',
    responsibilities: ['Build APIs', 'Write tests', 'Collaborate with team'],
    requirements: ['Node.js', 'MySQL', 'Git'],
    qualifications: ['BSc CS or equivalent experience'],
    allow_international: true,
    auto_offer: true,
    status: 'PUBLISHED',
  });

  const job2 = await ensureJob(rec1, {
    title: 'QA Engineer',
    company_name: 'Acme Corp',
    location: 'New York, NY',
    remote_flexible: false,
    job_type: 'CONTRACT',
    salary: 80000,
    intro: 'Ensure product quality.',
    description: 'Manual + automated testing.',
    responsibilities: ['Test planning', 'Automation scripts'],
    requirements: ['Playwright', 'Cypress', 'Jest'],
    qualifications: ['2+ years QA'],
    allow_international: false,
    auto_offer: false,
    status: 'DRAFT',
  });

  const job3 = await ensureJob(rec2, {
    title: 'Data Analyst',
    company_name: 'Globex Inc',
    location: 'San Francisco, CA',
    remote_flexible: true,
    job_type: 'FULL_TIME',
    salary: 100000,
    intro: 'Analyze KPIs and build dashboards.',
    description: 'SQL, BI tools, and storytelling.',
    responsibilities: ['Build dashboards', 'Analyze data', 'Communicate insights'],
    requirements: ['SQL', 'Tableau/PowerBI', 'Statistics'],
    qualifications: ['BSc or MSc in related field'],
    allow_international: false,
    auto_offer: false,
    status: 'PUBLISHED',
  });

  // Applications
  const app1 = await ensureApplication(job1, cand1, { source: 'APPLY', resume_url: 'https://example.com/resumes/jordan_kim.pdf', cover_letter: 'Excited to contribute!' });
  const app2 = await ensureApplication(job1, cand2, { source: 'APPLY', resume_url: 'https://example.com/resumes/taylor_nguyen.pdf' });
  const app3 = await ensureApplication(job3, cand2, { source: 'APPLY' });

  // Interview
  await ensureInterview(app1, '2025-08-30 09:00:00', { duration_minutes: 60, meeting_url: 'https://meet.example.com/abc123' });

  // Notifications (sample)
  await ensureNotification(cand1, {
    type: 'APPLICATION',
    title: 'Application received',
    message: 'Your application to Software Engineer was received.',
    data: { job_id: job1, application_id: app1, path: `/candidate/applications/${app1}` },
  });
  await ensureNotification(cand1, {
    type: 'INTERVIEW',
    title: 'Interview scheduled',
    message: 'Your interview for Software Engineer is scheduled at 2025-08-30 09:00:00.',
    data: { job_id: job1, application_id: app1, scheduled_at: '2025-08-30 09:00:00', path: `/candidate/applications/${app1}` },
  });
  await ensureNotification(cand2, {
    type: 'APPLICATION',
    title: 'Application received',
    message: 'Your application to Software Engineer was received.',
    data: { job_id: job1, application_id: app2, path: `/candidate/applications/${app2}` },
  });
  await ensureNotification(cand2, {
    type: 'APPLICATION',
    title: 'Application received',
    message: 'Your application to Data Analyst was received.',
    data: { job_id: job3, application_id: app3, path: `/candidate/applications/${app3}` },
  });

  await ensureNotification(rec1, {
    type: 'APPLICATION',
    title: 'New application',
    message: 'cand1@heyhr.test applied to Software Engineer.',
    data: { job_id: job1, application_id: app1, candidate_id: cand1, path: `/recruiter/applications/${app1}` },
  });
  await ensureNotification(rec1, {
    type: 'APPLICATION',
    title: 'New application',
    message: 'cand2@heyhr.test applied to Software Engineer.',
    data: { job_id: job1, application_id: app2, candidate_id: cand2, path: `/recruiter/applications/${app2}` },
  });
  await ensureNotification(rec2, {
    type: 'APPLICATION',
    title: 'New application',
    message: 'cand2@heyhr.test applied to Data Analyst.',
    data: { job_id: job3, application_id: app3, candidate_id: cand2, path: `/recruiter/applications/${app3}` },
  });

  console.log('---');
  console.log('Seed complete.');
  console.log(`Default password for all seeded users: ${DEFAULT_PASSWORD}`);
  console.log('Users:');
  console.log('- Recruiter: rec1@heyhr.test');
  console.log('- Recruiter: rec2@heyhr.test');
  console.log('- Candidate: cand1@heyhr.test');
  console.log('- Candidate: cand2@heyhr.test');

  try { await pool.end(); } catch {}
}

main().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
