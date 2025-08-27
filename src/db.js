import mysql from 'mysql2/promise';

export let pool;

export async function initDB() {
  if (pool) return pool;
  const {
    MYSQL_HOST = 'localhost',
    MYSQL_PORT = '3306',
    MYSQL_USER = 'root',
    MYSQL_PASSWORD = '',
    MYSQL_DB = 'heyhr',
  } = process.env;

  pool = mysql.createPool({
    host: MYSQL_HOST,
    port: Number(MYSQL_PORT),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DB,
    connectionLimit: 10,
    namedPlaceholders: true,
  });

  try {
    await bootstrap(pool);
  } catch (err) {
    // Handle missing database: create it then retry
    const isUnknownDb = err && (err.code === 'ER_BAD_DB_ERROR' || /Unknown database/i.test(err.sqlMessage || ''));
    if (isUnknownDb) {
      await createDatabaseIfMissing({
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: MYSQL_DB,
      });
      // Recreate pool bound to the newly created database
      try { await pool.end(); } catch {}

      pool = mysql.createPool({
        host: MYSQL_HOST,
        port: Number(MYSQL_PORT),
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: MYSQL_DB,
        connectionLimit: 10,
        namedPlaceholders: true,
      });
      await bootstrap(pool);
    } else {
      throw err;
    }
  }
  return pool;
}

async function bootstrap(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(191) NOT NULL UNIQUE,
      name VARCHAR(191) NULL,
      phone VARCHAR(32) NULL,
      password_hash VARCHAR(191) NOT NULL,
      role ENUM('RECRUITER','CANDIDATE') NOT NULL DEFAULT 'CANDIDATE',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Candidate profiles table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      user_id INT PRIMARY KEY,
      first_name VARCHAR(191) NULL,
      last_name VARCHAR(191) NULL,
      date_of_birth DATE NULL,
      avatar_url VARCHAR(512) NULL,
      resume_url VARCHAR(512) NULL,
      career_objective TEXT NULL,
      education JSON NULL,
      experience JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_candidate_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Ensure phone column exists for pre-existing databases (ignore duplicate column error)
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN phone VARCHAR(32) NULL AFTER name;`);
  } catch (err) {
    const dup = err && (err.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(err.sqlMessage || ''));
    if (!dup) throw err;
  }
  
  // Add benefits column to jobs table if it doesn't exist
  try {
    await pool.query(`ALTER TABLE jobs ADD COLUMN benefits TEXT NULL AFTER description;`);
  } catch (err) {
    const dup = err && (err.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(err.sqlMessage || ''));
    if (!dup) throw err;
  }

  // Jobs table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      recruiter_id INT NULL,
      title VARCHAR(191) NOT NULL,
      company_name VARCHAR(191) NULL,
      location VARCHAR(191) NULL,
      remote_flexible TINYINT(1) NOT NULL DEFAULT 0,
      job_type ENUM('FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','TEMPORARY','FREELANCE') NULL,
      salary INT NULL,
      interview_duration INT NULL,
      commencement_date DATE NULL,
      intro TEXT NULL,
      description TEXT NULL,
      benefits TEXT NULL,
      responsibilities JSON NULL,
      requirements JSON NULL,
      qualifications JSON NULL,
      other_details JSON NULL,
      skills_soft JSON NULL,
      skills_technical JSON NULL,
      skills_cognitive JSON NULL,
      hiring_start_date DATE NULL,
      hiring_end_date DATE NULL,
      application_start_date DATE NULL,
      application_end_date DATE NULL,
      position_close_date DATE NULL,
      allow_international TINYINT(1) NOT NULL DEFAULT 0,
      shortlist TINYINT(1) NOT NULL DEFAULT 0,
      auto_close TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('DRAFT','PUBLISHED') NOT NULL DEFAULT 'DRAFT',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_jobs_recruiter_id (recruiter_id),
      INDEX idx_jobs_status (status),
      CONSTRAINT fk_jobs_recruiter FOREIGN KEY (recruiter_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Recruiter profiles table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recruiter_profiles (
      user_id INT PRIMARY KEY,
      first_name VARCHAR(191) NULL,
      last_name VARCHAR(191) NULL,
      date_of_birth DATE NULL,
      company_name VARCHAR(191) NULL,
      position VARCHAR(191) NULL,
      avatar_url VARCHAR(512) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Applications table (candidate applications to jobs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id INT PRIMARY KEY AUTO_INCREMENT,
      job_id INT NOT NULL,
      candidate_id INT NOT NULL,
      status ENUM('APPLIED','PASSED','FAILED') NOT NULL DEFAULT 'APPLIED',
      source ENUM('APPLY','ADDED','REFERRED','DISCOVERED') NULL,
      resume_url VARCHAR(512) NULL,
      cover_letter TEXT NULL,
      score INT NULL,
      tags JSON NULL,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_app_job_candidate (job_id, candidate_id),
      INDEX idx_app_job (job_id),
      INDEX idx_app_candidate (candidate_id),
      INDEX idx_app_status (status),
      CONSTRAINT fk_app_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      CONSTRAINT fk_app_candidate FOREIGN KEY (candidate_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Notifications table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      type VARCHAR(50) NULL,
      title VARCHAR(191) NOT NULL,
      message TEXT NULL,
      data JSON NULL,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_notif_user (user_id),
      INDEX idx_notif_read (read_at),
      CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Migrations to align existing tables
  // Add salary column if missing
  try { await pool.query(`ALTER TABLE jobs ADD COLUMN salary INT NULL AFTER job_type;`); } catch (err) {
    const dup = err && (err.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(err.sqlMessage || ''));
    if (!dup && !/Unknown table/i.test(err.sqlMessage || '')) throw err;
  }
  // Add interview_duration if missing
  try { await pool.query(`ALTER TABLE jobs ADD COLUMN interview_duration INT NULL AFTER salary;`); } catch (err) {
    const dup = err && (err.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(err.sqlMessage || ''));
    if (!dup && !/Unknown table/i.test(err.sqlMessage || '')) throw err;
  }
  // Add position_close_date if missing
  try { await pool.query(`ALTER TABLE jobs ADD COLUMN position_close_date DATE NULL AFTER application_end_date;`); } catch (err) {
    const dup = err && (err.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(err.sqlMessage || ''));
    if (!dup && !/Unknown table/i.test(err.sqlMessage || '')) throw err;
  }
  // Add shortlist if missing
  try { await pool.query(`ALTER TABLE jobs ADD COLUMN shortlist TINYINT(1) NOT NULL DEFAULT 0 AFTER allow_international;`); } catch (err) {
    const dup = err && (err.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(err.sqlMessage || ''));
    if (!dup && !/Unknown table/i.test(err.sqlMessage || '')) throw err;
  }
  // Rename reasons_to_hire -> responsibilities (or add if neither exists)
  try { await pool.query(`ALTER TABLE jobs CHANGE COLUMN reasons_to_hire responsibilities JSON NULL;`); } catch (err) {
    const unknown = err && (/Unknown column/i.test(err.sqlMessage || '') || err.code === 'ER_BAD_FIELD_ERROR');
    if (unknown) {
      try { await pool.query(`ALTER TABLE jobs ADD COLUMN responsibilities JSON NULL AFTER description;`); } catch (e2) {
        const dup2 = e2 && (e2.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(e2.sqlMessage || ''));
        if (!dup2) throw e2;
      }
    } else if (!/Unknown table/i.test(err.sqlMessage || '')) {
      throw err;
    }
  }
  // Drop deprecated columns (ignore if they don't exist)
  const dropCols = ['department','remote_type','salary_min','salary_max','salary_currency','salary_period','reasons_to_hire','attributes'];
  for (const col of dropCols) {
    try { await pool.query(`ALTER TABLE jobs DROP COLUMN ${col};`); } catch (err) {
      const safe = err && (/Unknown column|Can\'t DROP/i.test(err.sqlMessage || '') || err.code === 'ER_CANT_DROP_FIELD_OR_KEY');
      if (!safe && !/Unknown table/i.test(err.sqlMessage || '')) throw err;
    }
  }

  // Migrate applications.status enum to simplified set ['APPLIED','PASSED','FAILED']
  try {
    const [rows] = await pool.query(`
      SELECT COLUMN_TYPE AS coltype
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'applications'
        AND COLUMN_NAME = 'status'
      LIMIT 1`);
    const coltype = rows && rows[0] && rows[0].coltype;
    const hasOldStatuses = coltype && (
      coltype.includes("'SCREENING'") ||
      coltype.includes("'INTERVIEW'") ||
      coltype.includes("'OFFER'") ||
      coltype.includes("'HIRED'") ||
      coltype.includes("'REJECTED'")
    );
    if (hasOldStatuses) {
      // Map old -> new first to satisfy enum constraint during MODIFY
      await pool.query(`UPDATE applications SET status = 'APPLIED' WHERE status IN ('SCREENING','INTERVIEW','OFFER')`);
      await pool.query(`UPDATE applications SET status = 'FAILED' WHERE status = 'REJECTED'`);
      await pool.query(`UPDATE applications SET status = 'PASSED' WHERE status = 'HIRED'`);
      // Now alter the enum definition
      await pool.query(`ALTER TABLE applications MODIFY COLUMN status ENUM('APPLIED','PASSED','FAILED') NOT NULL DEFAULT 'APPLIED'`);
    }
  } catch (err) {
    const safe = err && (/Unknown table|Unknown column/i.test(err.sqlMessage || '') || err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR');
    if (!safe) throw err;
  }
}

async function createDatabaseIfMissing({ host, port, user, password, database }) {
  const serverPool = mysql.createPool({
    host,
    port: Number(port),
    user,
    password,
    connectionLimit: 2,
    namedPlaceholders: true,
  });
  try {
    await serverPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
  } finally {
    try { await serverPool.end(); } catch {}
  }
}

export async function getUserByEmail(email) {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = :email LIMIT 1', { email });
  return rows[0] || null;
}

export async function getUserById(id) {
  const [rows] = await pool.query('SELECT id, email, name, phone, role FROM users WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

export async function getUserAuthById(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

export async function createUser({ email, name, phone, password_hash, role }) {
  const [res] = await pool.query(
    'INSERT INTO users (email, name, phone, password_hash, role) VALUES (:email, :name, :phone, :password_hash, :role)',
    { email, name: name || null, phone: phone || null, password_hash, role }
  );
  return { id: res.insertId };
}

export async function updateUserPassword(id, password_hash) {
  const [res] = await pool.query(
    'UPDATE users SET password_hash = :password_hash WHERE id = :id',
    { id, password_hash }
  );
  return { affectedRows: res.affectedRows };
}

export async function updateUserFields(id, patch) {
  const fields = [];
  const params = { id };
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    params.name = patch.name ?? null;
    fields.push('name = :name');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'phone')) {
    params.phone = patch.phone ?? null;
    fields.push('phone = :phone');
  }
  if (fields.length === 0) return { affectedRows: 0 };
  const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = :id`;
  const [res] = await pool.query(sql, params);
  return { affectedRows: res.affectedRows };
}

// -------------------- Notifications --------------------

export async function createNotification({ user_id, type, title, message, data }) {
  const params = {
    user_id,
    type: type ?? null,
    title,
    message: message ?? null,
    data: data ? JSON.stringify(data) : null,
  };
  const [res] = await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, data)
     VALUES (:user_id, :type, :title, :message, :data)`,
    params
  );
  return { id: res.insertId };
}

export async function getNotificationById(id) {
  const [rows] = await pool.query('SELECT * FROM notifications WHERE id = :id LIMIT 1', { id });
  const row = rows[0];
  if (!row) return null;
  const parseJson = (v) => {
    if (v === null || v === undefined) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
  };
  return {
    ...row,
    data: parseJson(row.data),
    read: !!row.read_at,
  };
}

export async function listNotificationsByUser(user_id, { unread_only, limit = 50, offset = 0 } = {}) {
  const where = ['user_id = :user_id'];
  const params = { user_id, limit: Number(limit), offset: Number(offset) };
  if (unread_only) where.push('read_at IS NULL');
  const sql = `
    SELECT * FROM notifications
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(read_at, created_at) DESC, id DESC
    LIMIT :limit OFFSET :offset`;
  const [rows] = await pool.query(sql, params);
  const parseJson = (v) => { if (v === null || v === undefined) return null; try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  return rows.map((r) => ({ ...r, data: parseJson(r.data), read: !!r.read_at }));
}

export async function markNotificationRead(id) {
  const [res] = await pool.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = :id`,
    { id }
  );
  return { affectedRows: res.affectedRows };
}

// -------------------- Applications --------------------

export async function createApplication({ job_id, candidate_id, source, resume_url, cover_letter }) {
  const params = {
    job_id,
    candidate_id,
    source: source ?? null,
    resume_url: resume_url ?? null,
    cover_letter: cover_letter ?? null,
  };
  const [res] = await pool.query(
    `INSERT INTO applications (job_id, candidate_id, source, resume_url, cover_letter)
     VALUES (:job_id, :candidate_id, :source, :resume_url, :cover_letter)`,
    params
  );
  return { id: res.insertId };
}

export async function getApplicationById(id) {
  const [rows] = await pool.query('SELECT * FROM applications WHERE id = :id LIMIT 1', { id });
  const row = rows[0];
  if (!row) return null;
  const parseJson = (v) => {
    if (v === null || v === undefined) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
  };
  return {
    ...row,
    tags: parseJson(row.tags),
  };
}

export async function getApplicationDetail(id) {
  const [rows] = await pool.query(
    `SELECT a.*, j.recruiter_id, j.title AS job_title, j.status AS job_status,
            u.email AS candidate_email, u.name AS candidate_name, u.phone AS candidate_phone,
            cp.first_name, cp.last_name, cp.avatar_url AS candidate_avatar_url, cp.resume_url AS candidate_resume_url
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     JOIN users u ON u.id = a.candidate_id
     LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
     WHERE a.id = :id
     LIMIT 1`,
    { id }
  );
  const row = rows[0];
  if (!row) return null;
  const parseJson = (v) => {
    if (v === null || v === undefined) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
  };
  const application = {
    id: row.id,
    job_id: row.job_id,
    candidate_id: row.candidate_id,
    status: row.status,
    source: row.source,
    resume_url: row.resume_url,
    cover_letter: row.cover_letter,
    score: row.score,
    tags: parseJson(row.tags),
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  const job = { id: row.job_id, recruiter_id: row.recruiter_id, title: row.job_title, status: row.job_status };
  const candidate = { id: row.candidate_id, email: row.candidate_email, name: row.candidate_name, phone: row.candidate_phone };
  const profile = { first_name: row.first_name, last_name: row.last_name, avatar_url: row.candidate_avatar_url, resume_url: row.candidate_resume_url };
  return { application, job, candidate, profile };
}

export async function listApplicationsByJob(job_id, { status, q, limit = 50, offset = 0 } = {}) {
  const where = ['a.job_id = :job_id'];
  const params = { job_id, limit: Number(limit), offset: Number(offset) };
  if (status) { where.push('a.status = :status'); params.status = status; }
  if (q) {
    where.push(`(u.email LIKE :q OR u.name LIKE :q OR cp.first_name LIKE :q OR cp.last_name LIKE :q)`);
    params.q = `%${q}%`;
  }
  const sql = `
    SELECT a.*, u.id AS cand_id, u.email, u.name, u.phone,
           cp.first_name, cp.last_name, cp.avatar_url, cp.resume_url
    FROM applications a
    JOIN users u ON u.id = a.candidate_id
    LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.created_at DESC
    LIMIT :limit OFFSET :offset`;
  const [rows] = await pool.query(sql, params);
  const parseJson = (v) => { if (v === null || v === undefined) return null; try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  return rows.map((r) => ({
    id: r.id,
    job_id: r.job_id,
    candidate_id: r.candidate_id,
    status: r.status,
    source: r.source,
    resume_url: r.resume_url,
    score: r.score,
    tags: parseJson(r.tags),
    created_at: r.created_at,
    candidate: { id: r.cand_id, email: r.email, name: r.name, phone: r.phone },
    profile: { first_name: r.first_name, last_name: r.last_name, avatar_url: r.avatar_url, resume_url: r.resume_url },
  }));
}

export async function countApplicationsByJob(job_id) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM applications WHERE job_id = :job_id`,
    { job_id }
  );
  const cnt = rows && rows[0] && (rows[0].cnt ?? rows[0].COUNT ?? rows[0]['COUNT(*)']);
  return Number(cnt ?? 0);
}

export async function countApplicationsByRecruiter(recruiter_id) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt 
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     WHERE j.recruiter_id = :recruiter_id`,
    { recruiter_id }
  );
  const cnt = rows && rows[0] && (rows[0].cnt ?? rows[0].COUNT ?? rows[0]['COUNT(*)']);
  return Number(cnt ?? 0);
}

export async function countApplicationsByRecruiterWithStatus(recruiter_id) {
  const [rows] = await pool.query(
    `SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN a.status = 'APPLIED' THEN 1 ELSE 0 END) AS applied,
      SUM(CASE WHEN a.status = 'PASSED' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN a.status = 'FAILED' THEN 1 ELSE 0 END) AS failed
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     WHERE j.recruiter_id = :recruiter_id`,
    { recruiter_id }
  );
  
  if (!rows || !rows[0]) {
    return { total: 0, applied: 0, passed: 0, failed: 0 };
  }
  
  return {
    total: Number(rows[0].total ?? 0),
    applied: Number(rows[0].applied ?? 0),
    passed: Number(rows[0].passed ?? 0),
    failed: Number(rows[0].failed ?? 0)
  };
}

export async function listApplicationsByCandidate(candidate_id, { status, limit = 50, offset = 0 } = {}) {
  const where = ['a.candidate_id = :candidate_id'];
  const params = { candidate_id, limit: Number(limit), offset: Number(offset) };
  if (status) { where.push('a.status = :status'); params.status = status; }
  const sql = `
    SELECT a.*, j.title AS job_title, j.status AS job_status
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.created_at DESC
    LIMIT :limit OFFSET :offset`;
  const [rows] = await pool.query(sql, params);
  const parseJson = (v) => { if (v === null || v === undefined) return null; try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  return rows.map((r) => ({
    id: r.id,
    job_id: r.job_id,
    candidate_id: r.candidate_id,
    status: r.status,
    source: r.source,
    resume_url: r.resume_url,
    score: r.score,
    tags: parseJson(r.tags),
    created_at: r.created_at,
    job: { id: r.job_id, title: r.job_title, status: r.job_status },
  }));
}

export async function updateApplication(id, patch) {
  const fields = [];
  const params = { id };
  const set = (col, val, transform) => { const pKey = `p_${col}`; params[pKey] = transform ? transform(val) : val; fields.push(`${col} = :${pKey}`); };
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;

  if (has('status')) set('status', patch.status);
  if (has('resume_url')) set('resume_url', patch.resume_url ?? null);
  if (has('cover_letter')) set('cover_letter', patch.cover_letter ?? null);
  if (has('score')) set('score', patch.score ?? null);
  if (has('tags')) set('tags', patch.tags ? JSON.stringify(patch.tags) : null);
  if (has('notes')) set('notes', patch.notes ?? null);
  if (fields.length === 0) return { affectedRows: 0 };
  const sql = `UPDATE applications SET ${fields.join(', ')} WHERE id = :id`;
  const [res] = await pool.query(sql, params);
  return { affectedRows: res.affectedRows };
}


export async function getCandidateProfile(user_id) {
  const [rows] = await pool.query(
    `SELECT user_id, first_name, last_name, date_of_birth, avatar_url, resume_url, career_objective, education, experience, created_at, updated_at
     FROM candidate_profiles WHERE user_id = :user_id LIMIT 1`,
    { user_id }
  );
  const row = rows[0];
  if (!row) return null;
  const parseJson = (v) => {
    if (v === null || v === undefined) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
  };
  return {
    ...row,
    education: parseJson(row.education),
    experience: parseJson(row.experience),
  };
}

export async function upsertCandidateProfile(user_id, patch) {
  const params = {
    user_id,
    first_name: patch.first_name ?? null,
    last_name: patch.last_name ?? null,
    date_of_birth: patch.date_of_birth ?? null,
    avatar_url: patch.avatar_url ?? null,
    resume_url: patch.resume_url ?? null,
    career_objective: patch.career_objective ?? null,
    education: patch.education ? JSON.stringify(patch.education) : null,
    experience: patch.experience ? JSON.stringify(patch.experience) : null,
  };
  const [res] = await pool.query(
    `INSERT INTO candidate_profiles
      (user_id, first_name, last_name, date_of_birth, avatar_url, resume_url, career_objective, education, experience)
     VALUES
      (:user_id, :first_name, :last_name, :date_of_birth, :avatar_url, :resume_url, :career_objective, :education, :experience)
     ON DUPLICATE KEY UPDATE
      first_name = VALUES(first_name),
      last_name = VALUES(last_name),
      date_of_birth = VALUES(date_of_birth),
      avatar_url = VALUES(avatar_url),
      resume_url = VALUES(resume_url),
      career_objective = VALUES(career_objective),
      education = VALUES(education),
      experience = VALUES(experience)`,
    params
  );
  return { affectedRows: res.affectedRows };
}

// Helper function to normalize string or array inputs
function normalizeStringOrArray(input) {
  if (!input) return null;
  // If it's a string, convert to array with single item
  if (typeof input === 'string') {
    return [input];
  }
  // If already an array, return as is
  return input;
}

export async function createJob(job) {
  // Helper function to convert string to JSON array
  const stringToJsonArray = (value) => {
    if (!value) return null;
    if (typeof value === 'string') {
      // Convert string to a single-item array
      return JSON.stringify([value]);
    }
    return JSON.stringify(value);
  };

  // Helper function to convert string to JSON object
  const stringToJsonObject = (value) => {
    if (!value) return null;
    if (typeof value === 'string') {
      // Convert string to a simple object with a 'value' property
      return JSON.stringify({ value });
    }
    return JSON.stringify(value);
  };

  const params = {
    recruiter_id: job.recruiter_id ?? null,
    title: job.title,
    company_name: job.company_name ?? null,
    location: job.location ?? null,
    remote_flexible: job.remote_flexible ? 1 : 0,
    job_type: job.job_type ?? null,
    salary: job.salary ?? null,
    interview_duration: job.interview_duration ?? null,
    commencement_date: job.commencement_date ?? null,
    intro: job.intro ?? null,
    description: job.description ?? null,
    benefits: job.benefits ?? null,
    responsibilities: stringToJsonArray(job.responsibilities),
    requirements: stringToJsonArray(job.requirements),
    qualifications: stringToJsonArray(job.qualifications),
    other_details: stringToJsonObject(job.other_details),
    skills_soft: job.skills_soft ? JSON.stringify(job.skills_soft) : null,
    skills_technical: job.skills_technical ? JSON.stringify(job.skills_technical) : null,
    skills_cognitive: job.skills_cognitive ? JSON.stringify(job.skills_cognitive) : null,
    application_start_date: job.application_start_date ?? null,
    application_end_date: job.application_end_date ?? null,
    position_close_date: job.position_close_date ?? null,
    allow_international: job.allow_international ? 1 : 0,
    shortlist: job.shortlist ?? null,
    // Map API auto_offer to DB auto_close, keep backward-compat with auto_close input if provided
    auto_close: (job.auto_offer ?? job.auto_close) ? 1 : 0,
    status: job.status,
  };
  const [res] = await pool.query(
    `INSERT INTO jobs (
      recruiter_id, title, company_name, location,
      remote_flexible, job_type, salary, interview_duration, commencement_date,
      intro, description, benefits, responsibilities, requirements, qualifications, other_details,
      skills_soft, skills_technical, skills_cognitive,
      application_start_date, application_end_date,
      position_close_date,
      allow_international, shortlist, auto_close, status
    ) VALUES (
      :recruiter_id, :title, :company_name, :location,
      :remote_flexible, :job_type, :salary, :interview_duration, :commencement_date,
      :intro, :description, :benefits, :responsibilities, :requirements, :qualifications, :other_details,
      :skills_soft, :skills_technical, :skills_cognitive,
      :application_start_date, :application_end_date,
      :position_close_date,
      :allow_international, :shortlist, :auto_close, :status
    )`,
    params
  );
  return { id: res.insertId };
}

export async function getJobById(id) {
  const [rows] = await pool.query('SELECT * FROM jobs WHERE id = :id LIMIT 1', { id });
  const row = rows[0];
  if (!row) return null;
  const parseJson = (v) => {
    if (v === null || v === undefined) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
  };
  const job = {
    ...row,
    remote_flexible: !!row.remote_flexible,
    allow_international: !!row.allow_international,
    shortlist: !!row.shortlist,
    auto_offer: !!row.auto_close,
    responsibilities: parseJson(row.responsibilities),
    requirements: parseJson(row.requirements),
    qualifications: parseJson(row.qualifications),
    other_details: parseJson(row.other_details),
    skills_soft: parseJson(row.skills_soft),
    skills_technical: parseJson(row.skills_technical),
    skills_cognitive: parseJson(row.skills_cognitive),
  };
  delete job.auto_close;
  return job;
}

export async function listJobsByRecruiter(recruiter_id, { status, limit = 50, offset = 0 } = {}) {
  const where = ['recruiter_id = :recruiter_id'];
  const params = { recruiter_id, limit: Number(limit), offset: Number(offset) };
  if (status) {
    where.push('status = :status');
    params.status = status;
  }
  const sql = `SELECT * FROM jobs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT :limit OFFSET :offset`;
  const [rows] = await pool.query(sql, params);
  const parseJson = (v) => {
    if (v === null || v === undefined) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
  };
  return rows.map((row) => {
    const job = {
      ...row,
      remote_flexible: !!row.remote_flexible,
      allow_international: !!row.allow_international,
      shortlist: !!row.shortlist,
      auto_offer: !!row.auto_close,
      responsibilities: parseJson(row.responsibilities),
      requirements: parseJson(row.requirements),
      qualifications: parseJson(row.qualifications),
      other_details: parseJson(row.other_details),
      skills_soft: parseJson(row.skills_soft),
      skills_technical: parseJson(row.skills_technical),
      skills_cognitive: parseJson(row.skills_cognitive),
    };
    delete job.auto_close;
    return job;
  });
}

export async function countPublishedJobs({ q, location, job_type, remote_flexible } = {}) {
  const where = [`status = 'PUBLISHED'`];
  const params = {};
  if (q) {
    where.push(`(title LIKE :q OR description LIKE :q OR company_name LIKE :q)`);
    params.q = `%${q}%`;
  }
  if (location) {
    where.push(`location LIKE :location`);
    params.location = `%${location}%`;
  }
  if (job_type) {
    where.push(`job_type = :job_type`);
    params.job_type = job_type;
  }
  if (remote_flexible) {
    where.push(`remote_flexible = 1`);
  }
  const sql = `SELECT COUNT(*) AS cnt FROM jobs WHERE ${where.join(' AND ')}`;
  const [rows] = await pool.query(sql, params);
  const cnt = rows && rows[0] && (rows[0].cnt ?? rows[0].COUNT ?? rows[0]['COUNT(*)']);
  return Number(cnt ?? 0);
}

export async function listPublishedJobs({ q, location, job_type, remote_flexible, limit = 50, offset = 0 } = {}) {
  const where = [`status = 'PUBLISHED'`];
  const params = { limit: Number(limit), offset: Number(offset) };
  if (q) {
    where.push(`(title LIKE :q OR description LIKE :q OR company_name LIKE :q)`);
    params.q = `%${q}%`;
  }
  if (location) {
    where.push(`location LIKE :location`);
    params.location = `%${location}%`;
  }
  if (job_type) {
    where.push(`job_type = :job_type`);
    params.job_type = job_type;
  }
  if (remote_flexible) {
    where.push(`remote_flexible = 1`);
  }

  const sql = `SELECT * FROM jobs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT :limit OFFSET :offset`;
  const [rows] = await pool.query(sql, params);
  const parseJson = (v) => {
    if (v === null || v === undefined) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
  };
  return rows.map((row) => {
    const job = {
      ...row,
      remote_flexible: !!row.remote_flexible,
      allow_international: !!row.allow_international,
      shortlist: !!row.shortlist,
      auto_offer: !!row.auto_close,
      responsibilities: parseJson(row.responsibilities),
      requirements: parseJson(row.requirements),
      qualifications: parseJson(row.qualifications),
      other_details: parseJson(row.other_details),
      skills_soft: parseJson(row.skills_soft),
      skills_technical: parseJson(row.skills_technical),
      skills_cognitive: parseJson(row.skills_cognitive),
    };
    delete job.auto_close;
    return job;
  });
}

export async function listPublishedJobsByRecruiter(recruiter_id, { limit = 50, offset = 0 } = {}) {
  const params = { recruiter_id, limit: Number(limit), offset: Number(offset) };
  const sql = `SELECT * FROM jobs WHERE recruiter_id = :recruiter_id AND status = 'PUBLISHED' ORDER BY created_at DESC LIMIT :limit OFFSET :offset`;
  const [rows] = await pool.query(sql, params);
  const parseJson = (v) => {
    if (v === null || v === undefined) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
  };
  return rows.map((row) => {
    const job = {
      ...row,
      remote_flexible: !!row.remote_flexible,
      allow_international: !!row.allow_international,
      shortlist: !!row.shortlist,
      auto_offer: !!row.auto_close,
      responsibilities: parseJson(row.responsibilities),
      requirements: parseJson(row.requirements),
      qualifications: parseJson(row.qualifications),
      other_details: parseJson(row.other_details),
      skills_soft: parseJson(row.skills_soft),
      skills_technical: parseJson(row.skills_technical),
      skills_cognitive: parseJson(row.skills_cognitive),
    };
    delete job.auto_close;
    return job;
  });
}

export async function getRecruiterProfile(user_id) {
  const [rows] = await pool.query(
    `SELECT user_id, first_name, last_name, date_of_birth, company_name, position, avatar_url, created_at, updated_at
     FROM recruiter_profiles WHERE user_id = :user_id LIMIT 1`,
    { user_id }
  );
  return rows[0] || null;
}

export async function upsertRecruiterProfile(user_id, patch) {
  const params = {
    user_id,
    first_name: patch.first_name ?? null,
    last_name: patch.last_name ?? null,
    date_of_birth: patch.date_of_birth ?? null,
    company_name: patch.company_name ?? null,
    position: patch.position ?? null,
    avatar_url: patch.avatar_url ?? null,
  };
  const [res] = await pool.query(
    `INSERT INTO recruiter_profiles
      (user_id, first_name, last_name, date_of_birth, company_name, position, avatar_url)
     VALUES
      (:user_id, :first_name, :last_name, :date_of_birth, :company_name, :position, :avatar_url)
     ON DUPLICATE KEY UPDATE
      first_name = VALUES(first_name),
      last_name = VALUES(last_name),
      date_of_birth = VALUES(date_of_birth),
      company_name = VALUES(company_name),
      position = VALUES(position),
      avatar_url = VALUES(avatar_url)`,
    params
  );
  return { affectedRows: res.affectedRows };
}

export async function deleteJob(id) {
  const [res] = await pool.query('DELETE FROM jobs WHERE id = :id', { id });
  return { affectedRows: res.affectedRows };
}

export async function closeJob(id) {
  const sql = `UPDATE jobs SET status = 'DRAFT' WHERE id = :id`;
  const [res] = await pool.query(sql, { id });
  return res.affectedRows > 0;
}

export async function reopenJob(id) {
  const sql = `UPDATE jobs SET status = 'PUBLISHED' WHERE id = :id`;
  const [res] = await pool.query(sql, { id });
  return res.affectedRows > 0;
}

export async function updateJob(id, patch) {
  const sets = [];
  const params = { id };

  if (patch.title !== undefined) {
    sets.push('title = :title');
    params.title = patch.title;
  }
  if (patch.company_name !== undefined) {
    sets.push('company_name = :company_name');
    params.company_name = patch.company_name;
  }
  if (patch.location !== undefined) {
    sets.push('location = :location');
    params.location = patch.location;
  }
  if (patch.remote_flexible !== undefined) {
    sets.push('remote_flexible = :remote_flexible');
    params.remote_flexible = patch.remote_flexible ? 1 : 0;
  }
  if (patch.job_type !== undefined) {
    sets.push('job_type = :job_type');
    params.job_type = patch.job_type;
  }
  if (patch.salary !== undefined) {
    sets.push('salary = :salary');
    params.salary = patch.salary;
  }
  if (patch.interview_duration !== undefined) {
    sets.push('interview_duration = :interview_duration');
    params.interview_duration = patch.interview_duration;
  }
  if (patch.commencement_date !== undefined) {
    sets.push('commencement_date = :commencement_date');
    params.commencement_date = patch.commencement_date;
  }
  if (patch.intro !== undefined) {
    sets.push('intro = :intro');
    params.intro = patch.intro;
  }
  if (patch.description !== undefined) {
    sets.push('description = :description');
    params.description = patch.description;
  }
  if (patch.benefits !== undefined) {
    sets.push('benefits = :benefits');
    params.benefits = patch.benefits;
  }
  if (patch.responsibilities !== undefined) {
    sets.push('responsibilities = :responsibilities');
    if (typeof patch.responsibilities === 'string') {
      params.responsibilities = JSON.stringify([patch.responsibilities]);
    } else {
      params.responsibilities = patch.responsibilities ? JSON.stringify(patch.responsibilities) : null;
    }
  }
  if (patch.requirements !== undefined) {
    sets.push('requirements = :requirements');
    if (typeof patch.requirements === 'string') {
      params.requirements = JSON.stringify([patch.requirements]);
    } else {
      params.requirements = patch.requirements ? JSON.stringify(patch.requirements) : null;
    }
  }
  if (patch.qualifications !== undefined) {
    sets.push('qualifications = :qualifications');
    if (typeof patch.qualifications === 'string') {
      params.qualifications = JSON.stringify([patch.qualifications]);
    } else {
      params.qualifications = patch.qualifications ? JSON.stringify(patch.qualifications) : null;
    }
  }
  if (patch.other_details !== undefined) {
    sets.push('other_details = :other_details');
    if (typeof patch.other_details === 'string') {
      params.other_details = JSON.stringify({ value: patch.other_details });
    } else {
      params.other_details = patch.other_details ? JSON.stringify(patch.other_details) : null;
    }
  }
  if (patch.skills_soft !== undefined) {
    sets.push('skills_soft = :skills_soft');
    params.skills_soft = patch.skills_soft ? JSON.stringify(patch.skills_soft) : null;
  }
  if (patch.skills_technical !== undefined) {
    sets.push('skills_technical = :skills_technical');
    params.skills_technical = patch.skills_technical ? JSON.stringify(patch.skills_technical) : null;
  }
  if (patch.skills_cognitive !== undefined) {
    sets.push('skills_cognitive = :skills_cognitive');
    params.skills_cognitive = patch.skills_cognitive ? JSON.stringify(patch.skills_cognitive) : null;
  }
  // hiring_start_date and hiring_end_date fields removed
  if (patch.application_start_date !== undefined) {
    sets.push('application_start_date = :application_start_date');
    params.application_start_date = patch.application_start_date;
  }
  if (patch.application_end_date !== undefined) {
    sets.push('application_end_date = :application_end_date');
    params.application_end_date = patch.application_end_date;
  }
  if (patch.position_close_date !== undefined) {
    sets.push('position_close_date = :position_close_date');
    params.position_close_date = patch.position_close_date;
  }
  if (patch.allow_international !== undefined) {
    sets.push('allow_international = :allow_international');
    params.allow_international = patch.allow_international ? 1 : 0;
  }
  if (patch.shortlist !== undefined) {
    sets.push('shortlist = :shortlist');
    params.shortlist = patch.shortlist;
  }
  if (patch.auto_offer !== undefined || patch.auto_close !== undefined) {
    sets.push('auto_close = :auto_close');
    params.auto_close = (patch.auto_offer ?? patch.auto_close) ? 1 : 0;
  }
  if (patch.status !== undefined) {
    sets.push('status = :status');
    params.status = patch.status;
  }
  
  if (sets.length === 0) return { affectedRows: 0 };

  const sql = `UPDATE jobs SET ${sets.join(', ')} WHERE id = :id`;
  const [res] = await pool.query(sql, params);
  return { affectedRows: res.affectedRows };
}
