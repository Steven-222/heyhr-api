import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initDB } from './db.js';
import authRouter from './routes/auth.js';
import jobsRouter from './routes/jobs.js';
import candidateRouter from './routes/candidate.js';
import recruiterRouter from './routes/recruiter.js';

const app = express();

// CORS + JSON + Cookies
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Serve frontend (SPA) from /web
app.use(express.static('web'));

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));
// (API index under /api-heyhr has been removed)

// Auth (shared for both roles)
app.use('/auth', authRouter);
// New mounts for role-specific paths
app.use('/recruiter/jobs', jobsRouter); // alias for recruiter management
app.use('/recruiter', recruiterRouter); // recruiter profiles (public/private)
app.use('/candidate', candidateRouter); // public candidate endpoints

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.name || 'ServerError', message: err.message || 'Unexpected error' });
});

const PORT = Number(process.env.PORT || 3001);

async function start() {
  const DB_OPTIONAL = String(process.env.DB_OPTIONAL || 'false') === 'true';
  const SKIP_DB = String(process.env.SKIP_DB || 'false') === 'true';
  if (SKIP_DB) {
    console.warn('[startup] SKIP_DB=true - skipping database initialization');
  } else {
    try {
      await initDB();
    } catch (e) {
      if (DB_OPTIONAL) {
        console.warn('[startup] DB not available. Continuing because DB_OPTIONAL=true. Reason:', e?.message || e);
      } else {
        throw e;
      }
    }
  }
  const server = app.listen(PORT, () => {
    console.log(`heyhr-api listening on http://localhost:${PORT}`);
  });

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, () => {
      console.log(`\nReceived ${signal}, shutting down...`);
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    });
  });
}

start().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
