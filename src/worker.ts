export interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
}

type SubmissionData = {
  name: string;
  company: string;
  email: string;
  numberOfVacancies: number;
  expectedHiringTimeline: string;
  notes: string;
};

const REQUIRED_FIELDS = [
  'Name',
  'Company Name',
  'Email',
  'NumberofVacancies',
  'Expected Hiring Timeline',
  'Notes',
] as const;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });

async function ensureSchema(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      email TEXT NOT NULL,
      number_of_vacancies INTEGER NOT NULL,
      expected_hiring_timeline TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  const migrationSql = [
    'ALTER TABLE submissions ADD COLUMN number_of_vacancies INTEGER',
    'ALTER TABLE submissions ADD COLUMN expected_hiring_timeline TEXT',
  ];

  for (const statement of migrationSql) {
    try {
      await env.DB.prepare(statement).run();
    } catch {
      // Ignore migration errors for existing columns.
    }
  }
}

async function verifyTurnstile(token: string, secretKey: string): Promise<boolean> {
  if (!token || !secretKey) {
    return false;
  }

  try {
    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
      }),
    });

    if (!result.ok) {
      return false;
    }

    const payload = (await result.json()) as { success?: boolean };
    return Boolean(payload.success);
  } catch {
    return false;
  }
}

function normalizeKey(input: string): string {
  return input.replace(/\s+/g, '').toLowerCase();
}

function getStringField(obj: Record<string, unknown>, key: string, aliases: string[] = []): string {
  const directCandidates = [key, ...aliases];

  for (const candidate of directCandidates) {
    const value = obj[candidate];
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value).trim();
    }
  }

  const normalizedKey = normalizeKey(key);
  for (const [objKey, value] of Object.entries(obj)) {
    if (normalizeKey(objKey) === normalizedKey) {
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number') return String(value).trim();
    }
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeKey(alias);
    for (const [objKey, value] of Object.entries(obj)) {
      if (normalizeKey(objKey) === normalizedAlias) {
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number') return String(value).trim();
      }
    }
  }

  return '';
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseValidatedSubmission(body: Record<string, unknown>): { data: SubmissionData; errors: string[] } {
  const errors: string[] = [];

  const fieldMap: Record<string, string> = {
    Name: getStringField(body, 'Name', ['name']),
    'Company Name': getStringField(body, 'Company Name', ['companyName', 'company', 'CompanyName']),
    Email: getStringField(body, 'Email', ['email']),
    NumberofVacancies: getStringField(body, 'NumberofVacancies', ['Number of Vacancies', 'numberOfVacancies', 'numberofvacancies']),
    'Expected Hiring Timeline': getStringField(body, 'Expected Hiring Timeline', ['expectedHiringTimeline', 'ExpectedHiringTimeline']),
    Notes: getStringField(body, 'Notes', ['notes']),
  };

  for (const key of REQUIRED_FIELDS) {
    if (!fieldMap[key]) {
      errors.push(`${key} is required.`);
    }
  }

  const name = fieldMap['Name'];
  const company = fieldMap['Company Name'];
  const email = fieldMap.Email;
  const numberOfVacancies = Number(fieldMap.NumberofVacancies);
  const expectedHiringTimeline = fieldMap['Expected Hiring Timeline'];
  const notes = fieldMap.Notes;

  if (email && !validateEmail(email)) {
    errors.push('Email must be a valid email address.');
  }

  if (!Number.isInteger(numberOfVacancies) || numberOfVacancies <= 0) {
    errors.push('Number of Vacancies must be a positive integer.');
  }

  if (errors.length > 0) {
    return {
      data: {
        name,
        company,
        email,
        numberOfVacancies: Number.isInteger(numberOfVacancies) ? numberOfVacancies : 0,
        expectedHiringTimeline,
        notes,
      },
      errors,
    };
  }

  return {
    data: {
      name,
      company,
      email,
      numberOfVacancies,
      expectedHiringTimeline,
      notes,
    },
    errors: [],
  };
}

async function saveSubmission(env: Env, data: SubmissionData) {
  return env.DB.prepare(`
    INSERT INTO submissions (
      name,
      company,
      email,
      number_of_vacancies,
      expected_hiring_timeline,
      notes
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    data.name,
    data.company,
    data.email,
    data.numberOfVacancies,
    data.expectedHiringTimeline,
    data.notes,
  ).run();
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    await ensureSchema(env);

    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(200, { ok: true, service: 'mbtedge-service' });
    }

    if (request.method !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    if (url.pathname !== '/api/submit') {
      return json(404, { error: 'Not found' });
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return json(415, { error: 'Expected JSON content type.' });
    }

    let body: Record<string, unknown> | null;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json(400, { error: 'Invalid JSON payload.' });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(400, { error: 'Expected a JSON object payload.' });
    }

    const turnstileToken = String(body.cfTurnstileResponse ?? body.turnstileToken ?? body.token ?? '');

    const { data, errors } = parseValidatedSubmission(body);
    if (errors.length > 0) {
      return json(400, { error: 'Validation failed.', details: errors });
    }

    const validToken = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY);
    if (!validToken) {
      return json(403, { error: 'Turnstile verification failed.' });
    }

    const insert = await saveSubmission(env, data);

    return json(200, {
      message: 'Submission accepted',
      id: insert.meta.last_row_id,
    });
  },
};
