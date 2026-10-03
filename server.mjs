import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 14));
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL。云端版必须连接 PostgreSQL。');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : undefined
});

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}
function makePassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashPassword(password, salt) };
}
function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(body));
}
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}
function safeUser(u) {
  return u && { id: u.id, username: u.username, name: u.name, role: u.role };
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2_000_000) throw new Error('请求内容过大');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
function cookieHeader(token, maxAgeSec = SESSION_DAYS * 86400) {
  const secure = isProd ? '; Secure' : '';
  return `sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}
function clearCookie() {
  const secure = isProd ? '; Secure' : '';
  return `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
async function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const h = tokenHash(token);
  const { rows } = await pool.query(`
    SELECT u.id,u.username,u.name,u.role
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE
  `, [h]);
  return rows[0] || null;
}
function cleanQuestionBody(b) {
  const tags = Array.isArray(b.tags)
    ? b.tags.map(x => String(x).trim()).filter(Boolean).slice(0, 20)
    : String(b.tags || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean).slice(0, 20);
  return {
    title: String(b.title || '').trim().slice(0, 200),
    type: String(b.type || '解答题').trim().slice(0, 50),
    grade: String(b.grade || '高三').trim().slice(0, 50),
    difficulty: String(b.difficulty || '中档').trim().slice(0, 50),
    topic: String(b.topic || '其他').trim().slice(0, 100),
    source: String(b.source || '手工录入').trim().slice(0, 300),
    tags,
    stem: String(b.stem || ''),
    answer: String(b.answer || ''),
    solution: String(b.solution || '')
  };
}
function questionFromRow(r) {
  return {
    id: r.id, title: r.title, type: r.type, grade: r.grade,
    difficulty: r.difficulty, topic: r.topic, source: r.source,
    tags: r.tags || [], stem: r.stem, answer: r.answer, solution: r.solution,
    createdBy: r.created_by_name || '未知', updatedBy: r.updated_by_name || '未知',
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','teacher')),
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      grade TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      topic TEXT NOT NULL,
      source TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      stem TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      solution TEXT NOT NULL DEFAULT '',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_questions_updated_at ON questions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic);
  `);

  await pool.query(`DELETE FROM sessions WHERE expires_at <= NOW()`);

  const adminUsername = String(process.env.ADMIN_USERNAME || 'admin').trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || '');
  const adminName = String(process.env.ADMIN_NAME || '管理员').trim();
  const existing = await pool.query('SELECT id FROM users WHERE username=$1', [adminUsername]);
  if (!existing.rows[0]) {
    if (!adminPassword) {
      throw new Error('首次部署需要设置环境变量 ADMIN_PASSWORD');
    }
    const p = makePassword(adminPassword);
    await pool.query(
      'INSERT INTO users(id,username,name,role,salt,password_hash) VALUES($1,$2,$3,$4,$5,$6)',
      [crypto.randomUUID(), adminUsername, adminName, 'admin', p.salt, p.hash]
    );
    console.log(`已创建管理员账号：${adminUsername}`);
  }

  const qCount = Number((await pool.query('SELECT COUNT(*) AS c FROM questions')).rows[0].c);
  if (qCount === 0) {
    const admin = (await pool.query("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1")).rows[0];
    const now = new Date().toISOString();
    const seed = [
      ['HD-2025MID-001','集合与 Venn 图','单选题','高三','基础','集合与逻辑','2025-2026 海淀高三期中',['集合','Venn图'],'设全集 $U=\\mathbb R$，$A=\\{-2,-1,1\\}$，$B=\\{x\\mid x^2-x\\le 0\\}$，则图中阴影部分表示的集合为（　）','A','由 $x^2-x\\le0$ 得 $0\\le x\\le1$，故 $B=[0,1]$。阴影表示 $A\\setminus B=\\{-2,-1\\}$。'],
      ['HD-2025MID-002','复数的模','单选题','高三','基础','复数','2025-2026 海淀高三期中',['复数','共轭复数'],'复数 $z$ 对应的点为 $(1,\\sqrt3)$，则 $z\\overline z=$（　）','D','$z=1+\\sqrt3 i$，所以 $z\\overline z=|z|^2=1+3=4$。'],
      ['HD-2025MID-015','扇形草坪上的运动','填空题','高三','较难','函数与导数','2025-2026 海淀高三期中',['导数','三角函数','函数零点'],'扇形半径 $OA=60$ 米，$\\angle AOB=\\frac{2\\pi}{3}$。甲沿 $OA$ 运动，乙沿弧 $AB$ 运动，记两人距离为 $f(t)$。判断给出的四个结论。','①②④','令 $g(t)=f^2(t)=t^2+3600-120t\\cos\\frac{\\pi t}{90}$。通过 $g\'(t)$ 的符号判断单调性，并用具体点的函数值配合零点存在性定理确定最小值点。'],
      ['HD-2025MID-021','满足性质 P 的 0-1 数表','解答题','高三','压轴','计数原理','2025-2026 海淀高三期中',['组合数学','构造法','极值'],'给定 $n\\ge3$，$A=(a_{ij})$ 为 $n\\times n$ 的 0-1 数表，并满足若干条件，研究性质 $P$ 及列和集合 $M$。','(1) 不具有；(2) $n_{\\min}=5$；(3) 分情况取 $3,7,2n-4$。','记第 $j$ 列和为 $s_j$。有 $2\\le s_j\\le n-1$ 且 $\\sum s_j=\\frac{n(n-1)}2$。结合上界估计和递推构造得到结论。']
    ];
    for (const s of seed) {
      await pool.query(`INSERT INTO questions(id,title,type,grade,difficulty,topic,source,tags,stem,answer,solution,created_by,updated_by,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$12,$13,$13) ON CONFLICT DO NOTHING`,
        [s[0],s[1],s[2],s[3],s[4],s[5],s[6],JSON.stringify(s[7]),s[8],s[9],s[10],admin?.id || null,now]);
    }
  }
}

function serveStatic(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  let rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
  rel = path.normalize(rel).replace(/^([.][.][/\\])+/, '');
  const file = path.join(publicDir, rel);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file).toLowerCase();
  const map = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
  res.writeHead(200, { 'Content-Type': map[ext] || 'application/octet-stream', 'Cache-Control':'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}

async function requireUser(req, res) {
  const u = await currentUser(req);
  if (!u) { json(res, 401, { error: '未登录' }); return null; }
  return u;
}
async function requireAdmin(req, res) {
  const u = await requireUser(req, res);
  if (!u) return null;
  if (u.role !== 'admin') { json(res, 403, { error: '仅管理员可以执行此操作' }); return null; }
  return u;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      await pool.query('SELECT 1');
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const { username, password } = await readBody(req);
      const { rows } = await pool.query('SELECT * FROM users WHERE username=$1 AND active=TRUE', [String(username || '').trim()]);
      const u = rows[0];
      if (!u || hashPassword(password || '', u.salt) !== u.password_hash) return json(res, 401, { error: '账号或密码错误' });
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
      await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [tokenHash(token), u.id, expires]);
      return json(res, 200, { user: safeUser(u) }, { 'Set-Cookie': cookieHeader(token) });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = parseCookies(req).sid;
      if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
      return json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
    }
    if (url.pathname === '/api/me' && req.method === 'GET') {
      const u = await requireUser(req, res); if (!u) return;
      return json(res, 200, { user: safeUser(u) });
    }
    if (url.pathname === '/api/questions' && req.method === 'GET') {
      const u = await requireUser(req, res); if (!u) return;
      const { rows } = await pool.query(`
        SELECT q.*, cu.name AS created_by_name, uu.name AS updated_by_name
        FROM questions q
        LEFT JOIN users cu ON cu.id=q.created_by
        LEFT JOIN users uu ON uu.id=q.updated_by
        ORDER BY q.updated_at DESC
      `);
      return json(res, 200, { questions: rows.map(questionFromRow), serverTime: new Date().toISOString() });
    }
    if (url.pathname === '/api/questions' && req.method === 'POST') {
      const u = await requireUser(req, res); if (!u) return;
      const q = cleanQuestionBody(await readBody(req));
      if (!q.title || !q.stem) return json(res, 400, { error: '请至少填写标题和题干' });
      const id = `Q-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const { rows } = await pool.query(`INSERT INTO questions(id,title,type,grade,difficulty,topic,source,tags,stem,answer,solution,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$12) RETURNING *`,
        [id,q.title,q.type,q.grade,q.difficulty,q.topic,q.source,JSON.stringify(q.tags),q.stem,q.answer,q.solution,u.id]);
      const row = rows[0]; row.created_by_name=u.name; row.updated_by_name=u.name;
      return json(res, 201, { question: questionFromRow(row) });
    }
    const qm = url.pathname.match(/^\/api\/questions\/([^/]+)$/);
    if (qm && req.method === 'PUT') {
      const u = await requireUser(req, res); if (!u) return;
      const q = cleanQuestionBody(await readBody(req));
      if (!q.title || !q.stem) return json(res, 400, { error: '请至少填写标题和题干' });
      const { rows } = await pool.query(`UPDATE questions SET title=$2,type=$3,grade=$4,difficulty=$5,topic=$6,source=$7,tags=$8::jsonb,stem=$9,answer=$10,solution=$11,updated_by=$12,updated_at=NOW() WHERE id=$1 RETURNING *`,
        [decodeURIComponent(qm[1]),q.title,q.type,q.grade,q.difficulty,q.topic,q.source,JSON.stringify(q.tags),q.stem,q.answer,q.solution,u.id]);
      if (!rows[0]) return json(res, 404, { error: '题目不存在' });
      const row=rows[0];
      const names = await pool.query('SELECT name FROM users WHERE id=$1',[row.created_by]);
      row.created_by_name=names.rows[0]?.name || '未知'; row.updated_by_name=u.name;
      return json(res, 200, { question: questionFromRow(row) });
    }
    if (qm && req.method === 'DELETE') {
      const u = await requireAdmin(req, res); if (!u) return;
      const r = await pool.query('DELETE FROM questions WHERE id=$1', [decodeURIComponent(qm[1])]);
      if (!r.rowCount) return json(res, 404, { error: '题目不存在' });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/users' && req.method === 'GET') {
      const u = await requireAdmin(req, res); if (!u) return;
      const { rows } = await pool.query('SELECT id,username,name,role,active,created_at FROM users ORDER BY created_at ASC');
      return json(res, 200, { users: rows });
    }
    if (url.pathname === '/api/users' && req.method === 'POST') {
      const u = await requireAdmin(req, res); if (!u) return;
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const name = String(b.name || '').trim();
      const password = String(b.password || '');
      if (!/^[A-Za-z0-9_.-]{3,40}$/.test(username)) return json(res, 400, { error: '用户名需为 3-40 位字母、数字、点、下划线或短横线' });
      if (!name) return json(res, 400, { error: '请输入教师姓名' });
      if (password.length < 8) return json(res, 400, { error: '初始密码至少 8 位' });
      const p = makePassword(password);
      try {
        const { rows } = await pool.query('INSERT INTO users(id,username,name,role,salt,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,username,name,role,active,created_at',
          [crypto.randomUUID(),username,name,'teacher',p.salt,p.hash]);
        return json(res, 201, { user: rows[0] });
      } catch (e) {
        if (e.code === '23505') return json(res, 409, { error: '用户名已存在' });
        throw e;
      }
    }
    const um = url.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (um && req.method === 'PATCH') {
      const admin = await requireAdmin(req, res); if (!admin) return;
      const id = decodeURIComponent(um[1]);
      if (id === admin.id) return json(res, 400, { error: '不能在这里停用当前管理员账号' });
      const b = await readBody(req);
      const active = Boolean(b.active);
      const { rows } = await pool.query("UPDATE users SET active=$2 WHERE id=$1 AND role='teacher' RETURNING id,username,name,role,active,created_at", [id, active]);
      if (!rows[0]) return json(res, 404, { error: '教师账号不存在' });
      if (!active) await pool.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      return json(res, 200, { user: rows[0] });
    }
    if (serveStatic(req, res)) return;
    res.writeHead(404); res.end('Not Found');
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message === '请求内容过大' ? e.message : '服务器内部错误' });
  }
});

await initDb();
server.listen(PORT, '0.0.0.0', () => console.log(`TiJian Online Cloud running on port ${PORT}`));
