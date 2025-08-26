
// Helper: normalize text into trimmed non-empty lines
function normalizeLines(text) {
  return text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\u00A0/g, ' ').trim())
    .filter((l) => l.length > 0);
}

// Helper: find a value that appears on the same line as any header (e.g., "Job Title: ...")
function getInlineValue(lines, headerRegexes) {
  for (const rx of headerRegexes) {
    for (const line of lines) {
      const m = line.match(new RegExp(`^\n?\t?\r?\s*(?:${rx.source})\s*[:\-]\s*(.+)$`, rx.flags.replace('g', '')));
      if (m) return m[1].trim();
    }
  }
  return undefined;
}

// Helper: find a value that appears on the next line after a header-only line
function getNextLineValue(lines, headerRegexes) {
  for (let i = 0; i < lines.length; i++) {
    for (const rx of headerRegexes) {
      if (rx.test(lines[i])) {
        const next = lines[i + 1];
        if (next && next.trim()) return next.trim();
      }
    }
  }
  return undefined;
}

function parseDateISO(s) {
  // Accept YYYY-MM-DD or YYYY/MM/DD
  const m = String(s).match(/(\d{4})[\/-](\d{2})[\/-](\d{2})/);
  if (!m) return undefined;
  const [_, y, mo, d] = m;
  const iso = `${y}-${mo}-${d}`;
  // Validate
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return undefined;
  return iso;
}

function parseInteger(str) {
  if (!str) return undefined;
  const m = String(str).replace(/[,\s]/g, '').match(/(\d{3,}|\d{1,2})(?:\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function parseDurationToMinutes(str) {
  if (!str) return undefined;
  const s = String(str);
  const mHr = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i);
  const mMin = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/i);
  if (mHr) return Math.round(Number(mHr[1]) * 60);
  if (mMin) return Math.round(Number(mMin[1]));
  return undefined;
}

function sectionRange(lines, startIndex) {
  // Return [start, end) indices for a section starting at startIndex until next probable header
  const headerLike = /^(?:[A-Z][A-Za-z\s]{0,60}|[A-Z\s]{2,60})(?:\:)?$/; // Simple heuristic
  let end = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (headerLike.test(line) || /:\s*$/.test(line)) { // likely a new header
      end = i;
      break;
    }
  }
  return [startIndex, end];
}

function getSection(lines, headerRegexes) {
  for (let i = 0; i < lines.length; i++) {
    for (const rx of headerRegexes) {
      if (rx.test(lines[i])) {
        const [s, e] = sectionRange(lines, i);
        // If the header line contains a trailing colon, drop it
        const body = lines.slice(s + 1, e);
        return body;
      }
    }
  }
  return undefined;
}

function parseBulletList(sectionLines) {
  if (!sectionLines || sectionLines.length === 0) return undefined;
  const items = [];
  for (const raw of sectionLines) {
    const line = raw.replace(/^[-•*\d\)\(\s\.]+/, '').trim();
    if (line.length > 0) items.push(line);
  }
  return items.length > 0 ? items : undefined;
}

function guessTitle(lines) {
  // Heuristic: first non-empty line with 2+ words and not a known header word
  const blacklist = /^(?:job\s*title|company|company\s*name|location|job\s*type|salary|compensation|description|overview|responsibilities|requirements|qualifications)\b/i;
  for (const l of lines) {
    if (!blacklist.test(l) && l.split(/\s+/).length >= 2) return l.replace(/\s+\|\s+.*$/, '');
  }
  return undefined;
}

function detectJobType(fullText) {
  const s = fullText.toUpperCase();
  if (/FULL[\s-]?TIME/.test(s)) return 'FULL_TIME';
  if (/PART[\s-]?TIME/.test(s)) return 'PART_TIME';
  if (/INTERNSHIP|INTERN\b/.test(s)) return 'INTERNSHIP';
  if (/CONTRACTOR?|TEMPORARY|TEMP\b/.test(s)) return /CONTRACTOR?/.test(s) ? 'CONTRACT' : 'TEMPORARY';
  if (/FREELANCE/.test(s)) return 'FREELANCE';
  return undefined;
}

function detectRemote(fullText) {
  const s = fullText.toLowerCase();
  if (/remote|hybrid|work\s*from\s*home/.test(s)) return true;
  if (/onsite\s*only/.test(s)) return false;
  return undefined;
}

function detectInternational(fullText) {
  const s = fullText.toLowerCase();
  if (/(international\s+applicants|visa\s*sponsorship)/.test(s) && !/not\s*eligible|not\s*accepted/.test(s)) return true;
  if (/international\s+applicants\s+not\s+(?:eligible|accepted)/.test(s)) return false;
  return undefined;
}

// pdf parsing is loaded dynamically inside extractJobFieldsFromPdf() to avoid startup issues with pdf-parse debug mode
export async function extractJobFieldsFromPdf(buffer) {
  let pdfParse;
  try {
    const mod = await import('pdf-parse-debugging-disabled');
    pdfParse = mod.default || mod;
  } catch (e) {
    console.error('Failed to load pdf-parse', e);
    const err = new Error('PdfParseImportError');
    err.cause = e;
    throw err;
  }
  const { text } = await pdfParse(buffer);
  const lines = normalizeLines(text);
  const fullText = lines.join('\n');

  // Primitive fields
  const title = getInlineValue(lines, [/^job\s*title/i]) || getNextLineValue(lines, [/^job\s*title/i]) || guessTitle(lines);
  const company_name = getInlineValue(lines, [/^company(?:\s*name)?/i, /^employer/i]) || getNextLineValue(lines, [/^company(?:\s*name)?/i, /^employer/i]);
  const location = getInlineValue(lines, [/^location/i]) || getNextLineValue(lines, [/^location/i]);

  const jobTypeRaw = getInlineValue(lines, [/^job\s*type/i, /^employment\s*type/i]) || getNextLineValue(lines, [/^job\s*type/i, /^employment\s*type/i]) || detectJobType(fullText);
  const job_type = jobTypeRaw || undefined;

  const salaryRaw = getInlineValue(lines, [/^salary/i, /^compensation/i, /^pay\b/i]) || getNextLineValue(lines, [/^salary/i, /^compensation/i, /^pay\b/i]);
  const salary = parseInteger(salaryRaw || fullText);

  const startRaw = getInlineValue(lines, [/^start\s*date/i, /^commencement/i]) || getNextLineValue(lines, [/^start\s*date/i, /^commencement/i]);
  const commencement_date = parseDateISO(startRaw);

  const interviewRaw = getInlineValue(lines, [/^interview\s*duration/i]) || getNextLineValue(lines, [/^interview\s*duration/i]);
  const interview_duration = parseDurationToMinutes(interviewRaw);

  // Dates (optional)
  const hiring_start_date = parseDateISO(getInlineValue(lines, [/^hiring\s*start/i])) || undefined;
  const hiring_end_date = parseDateISO(getInlineValue(lines, [/^hiring\s*end/i])) || undefined;
  const application_start_date = parseDateISO(getInlineValue(lines, [/^application\s*start/i])) || undefined;
  const application_end_date = parseDateISO(getInlineValue(lines, [/^application\s*end/i])) || undefined;
  const position_close_date = parseDateISO(
    getInlineValue(lines, [/^closing\s*date/i, /^application\s*deadline/i, /^close\s*date/i])
  ) || undefined;

  // Sections
  const descriptionSection = getSection(lines, [/^description/i, /^overview/i, /^about\s+the\s+role/i]);
  const responsibilitiesSection = getSection(lines, [/^responsibilities/i, /^duties/i, /^what\s+you\s+will\s+do/i]);
  const requirementsSection = getSection(lines, [/^requirements/i, /^what\s+you\s+bring/i]);
  const qualificationsSection = getSection(lines, [/^qualifications/i]);

  const description = descriptionSection ? descriptionSection.join('\n') : undefined;
  const responsibilities = parseBulletList(responsibilitiesSection);
  const requirements = parseBulletList(requirementsSection);
  const qualifications = parseBulletList(qualificationsSection);

  // Skills (optional)
  const skillsSoft = parseBulletList(getSection(lines, [/^soft\s*skills/i])) || undefined;
  const skillsTechnical = parseBulletList(getSection(lines, [/^technical\s*skills|tech\s*skills/i])) || undefined;
  const skillsCognitive = parseBulletList(getSection(lines, [/^cognitive\s*skills|analytical\s*skills/i])) || undefined;

  const defaultWeight = 50;
  const skills_soft = skillsSoft ? skillsSoft.map((name) => ({ name, weight: defaultWeight })) : undefined;
  const skills_technical = skillsTechnical ? skillsTechnical.map((name) => ({ name, weight: defaultWeight })) : undefined;
  const skills_cognitive = skillsCognitive ? skillsCognitive.map((name) => ({ name, weight: defaultWeight })) : undefined;

  const remote_flexible = detectRemote(fullText);
  const allow_international = detectInternational(fullText);

  const intro = description ? description.split(/\n{2,}/)[0]?.slice(0, 300) : undefined;

  const other_details = { raw_text_preview: fullText.slice(0, 2000) };

  // Return suggested payload compatible with JobCreateSchema (optional fields omitted if not found)
  const suggested = {
    title,
    company_name,
    location,
    remote_flexible,
    job_type,
    salary,
    interview_duration,
    commencement_date,
    intro,
    description,
    responsibilities,
    requirements,
    qualifications,
    other_details,
    skills_soft,
    skills_technical,
    skills_cognitive,
    hiring_start_date,
    hiring_end_date,
    application_start_date,
    application_end_date,
    position_close_date,
    allow_international,
    shortlist: undefined,
    auto_offer: undefined,
    status: undefined,
  };

  // Remove undefined keys for cleanliness
  Object.keys(suggested).forEach((k) => suggested[k] === undefined && delete suggested[k]);

  return suggested;
}
