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
    if (size > 15_000_000) throw new Error('请求内容过大');
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
function cleanImages(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x || '')).filter(x => /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/i.test(x) && x.length <= 2_600_000).slice(0, 6);
}
function cleanLayout(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const placement = ['below','right','left'].includes(String(v.imagePlacement||'')) ? String(v.imagePlacement) : 'below';
  const align = ['left','center','right'].includes(String(v.align||'')) ? String(v.align) : 'left';
  const ratio = Number(v.imageWidthRatio);
  const maxMm = Number(v.imageMaxWidthMm);
  const printRatio = Number(v.printWidthRatio);
  const printMaxMm = Number(v.printMaxWidthMm);
  const gridColumns = Number(v.gridColumns);
  const imageGapPx = Number(v.imageGapPx);
  return {
    imagePlacement: placement,
    align,
    imageWidthRatio: Number.isFinite(ratio) ? Math.min(1, Math.max(0.1, ratio)) : undefined,
    imageMaxWidthMm: Number.isFinite(maxMm) ? Math.min(180, Math.max(20, maxMm)) : undefined,
    gridColumns: Number.isFinite(gridColumns) ? Math.min(4, Math.max(1, Math.round(gridColumns))) : 1,
    imageGapPx: Number.isFinite(imageGapPx) ? Math.min(40, Math.max(0, Math.round(imageGapPx))) : 12,
    printWidthRatio: Number.isFinite(printRatio) ? Math.min(1, Math.max(0.1, printRatio)) : undefined,
    printMaxWidthMm: Number.isFinite(printMaxMm) ? Math.min(180, Math.max(20, printMaxMm)) : undefined,
    textWrap: Boolean(v.textWrap),
    keepWithStem: v.keepWithStem !== false,
    pageBreakInsideAvoid: v.pageBreakInsideAvoid !== false
  };
}

const TAXONOMY = [
  ['第一章 集合与常用逻辑用语',['第1节 集合','第2节 常用逻辑用语']],
  ['第二章 不等式',['第1节 等式与不等式的性质','第2节 基本不等式及其应用','第3节 二次函数与一元二次方程、不等式']],
  ['第三章 函数',['第1节 函数的概念','第2节 函数的单调性与最值','第3节 函数的奇偶性、周期性、对称性','第4节 二次函数与幂函数','第5节 指数与指数函数','第6节 对数与对数函数','第7节 函数的图象','第8节 函数的零点与方程的解','第9节 函数模型及其应用']],
  ['第四章 导数及其应用',['第1节 变化率与导数、导数的运算','第2节 导数与函数的单调性','第3节 导数与函数的极值、最值']],
  ['第五章 三角函数与解三角形',['第1节 任意角与弧度制、三角函数的概念','第2节 同角三角函数的基本关系及诱导公式','第3节 三角恒等变换','第4节 三角函数的图象与性质','第5节 函数 y=A sin(ωx+φ)','第6节 解三角形']],
  ['第六章 平面向量与复数',['第1节 平面向量的概念及线性运算','第2节 平面向量基本定理及坐标表示','第3节 平面向量的数量积及其应用','第4节 复数']],
  ['第七章 数列',['第1节 数列的概念及简单表示','第2节 等差数列','第3节 等比数列','第4节 数列求和']],
  ['第八章 立体几何与空间向量',['第1节 空间几何体的结构特征、表面积和体积','第2节 空间点、线、面的位置关系','第3节 直线、平面平行的判定与性质','第4节 直线、平面垂直的判定与性质','第5节 空间向量及其运算','第6节 空间角与空间距离']],
  ['第九章 平面解析几何',['第1节 直线的方程','第2节 圆的方程','第3节 直线与圆、圆与圆的位置关系','第4节 椭圆及其性质','第5节 双曲线及其性质','第6节 抛物线及其性质']],
  ['第十章 计数原理',['第1节 计数原理、排列与组合','第2节 二项式定理']],
  ['第十一章 概率与统计',['第1节 随机事件与古典概型','第2节 条件概率、全概率公式、n重伯努利试验与二项分布','第3节 离散型随机变量及其分布列、超几何分布','第4节 离散型随机变量的均值与方差','第5节 随机抽样','第6节 用样本估计总体']]
];
const TAXONOMY_SECTIONS = new Map(TAXONOMY.flatMap(([c,ss])=>ss.map(x=>[x,c])));
function inferTaxonomy(raw={}) {
  const givenChapter=String(raw.chapter||'').trim();
  const givenSection=String(raw.section||'').trim();
  if (TAXONOMY_SECTIONS.has(givenSection)) return {chapter:TAXONOMY_SECTIONS.get(givenSection),section:givenSection};
  if (TAXONOMY.some(([c])=>c===givenChapter) && givenSection) return {chapter:givenChapter,section:givenSection};
  const text=[raw.title,raw.topic,raw.chapter,raw.stem,raw.solution,...(Array.isArray(raw.tags)?raw.tags:[])].filter(Boolean).join(' ');
  const has=(re)=>re.test(text);
  let chapter='',section='';
  const pick=(c,s)=>({chapter:c,section:s});
  // Highly specific sections first.
  if(has(/复数|共轭复数|虚数|复平面/)) return pick('第六章 平面向量与复数','第4节 复数');
  if(has(/二项式定理|二项展开|组合数.*展开|\(a\+b\)\^n/)) return pick('第十章 计数原理','第2节 二项式定理');
  if(has(/排列|组合|计数原理|乘法原理|加法原理|0-1数表|组合数学/)) return pick('第十章 计数原理','第1节 计数原理、排列与组合');
  if(has(/椭圆/)) return pick('第九章 平面解析几何','第4节 椭圆及其性质');
  if(has(/双曲线/)) return pick('第九章 平面解析几何','第5节 双曲线及其性质');
  if(has(/抛物线/)) return pick('第九章 平面解析几何','第6节 抛物线及其性质');
  if(has(/圆.*位置关系|直线.*圆|圆与圆|相切|圆心距/)) return pick('第九章 平面解析几何','第3节 直线与圆、圆与圆的位置关系');
  if(has(/圆的方程|圆心|半径|圆.*标准方程/)) return pick('第九章 平面解析几何','第2节 圆的方程');
  if(has(/直线的方程|斜率|截距|两点式|点斜式|一般式/)) return pick('第九章 平面解析几何','第1节 直线的方程');
  if(has(/空间向量/)) return pick('第八章 立体几何与空间向量','第5节 空间向量及其运算');
  if(has(/二面角|线面角|异面直线.*角|空间距离|点到平面.*距离/)) return pick('第八章 立体几何与空间向量','第6节 空间角与空间距离');
  if(has(/线面垂直|面面垂直|垂直.*判定|垂直.*性质/)) return pick('第八章 立体几何与空间向量','第4节 直线、平面垂直的判定与性质');
  if(has(/线面平行|面面平行|平行.*判定|平行.*性质/)) return pick('第八章 立体几何与空间向量','第3节 直线、平面平行的判定与性质');
  if(has(/点线面|异面直线|空间.*位置关系/)) return pick('第八章 立体几何与空间向量','第2节 空间点、线、面的位置关系');
  if(has(/棱柱|棱锥|圆柱|圆锥|球|表面积|体积|空间几何体/)) return pick('第八章 立体几何与空间向量','第1节 空间几何体的结构特征、表面积和体积');
  if(has(/等差数列/)) return pick('第七章 数列','第2节 等差数列');
  if(has(/等比数列/)) return pick('第七章 数列','第3节 等比数列');
  if(has(/数列求和|前n项和|前 n 项和|错位相减|裂项|求和/)) return pick('第七章 数列','第4节 数列求和');
  if(has(/数列|递推|通项公式/)) return pick('第七章 数列','第1节 数列的概念及简单表示');
  if(has(/解三角形|正弦定理|余弦定理|三角形.*面积/)) return pick('第五章 三角函数与解三角形','第6节 解三角形');
  if(has(/A\s*\\?sin|Asin|ω|omega|相位|振幅|周期变换/)) return pick('第五章 三角函数与解三角形','第5节 函数 y=A sin(ωx+φ)');
  if(has(/诱导公式|同角三角函数|平方关系|商数关系/)) return pick('第五章 三角函数与解三角形','第2节 同角三角函数的基本关系及诱导公式');
  if(has(/和差角|二倍角|倍角|辅助角|三角恒等变换|降幂/)) return pick('第五章 三角函数与解三角形','第3节 三角恒等变换');
  if(has(/三角函数.*图象|三角函数.*单调|三角函数.*最值|正弦函数|余弦函数|正切函数/)) return pick('第五章 三角函数与解三角形','第4节 三角函数的图象与性质');
  if(has(/任意角|弧度制|终边|三角函数的定义/)) return pick('第五章 三角函数与解三角形','第1节 任意角与弧度制、三角函数的概念');
  if(has(/导数.*极值|导数.*最值|极大值|极小值/)) return pick('第四章 导数及其应用','第3节 导数与函数的极值、最值');
  if(has(/导数.*单调|单调.*导数|f'\s*\(/)) return pick('第四章 导数及其应用','第2节 导数与函数的单调性');
  if(has(/导数|变化率|切线.*斜率|求导/)) return pick('第四章 导数及其应用','第1节 变化率与导数、导数的运算');
  if(has(/函数.*零点|零点存在性|方程的解|根的分布/)) return pick('第三章 函数','第8节 函数的零点与方程的解');
  if(has(/指数函数|指数运算/)) return pick('第三章 函数','第5节 指数与指数函数');
  if(has(/对数函数|对数运算|log/)) return pick('第三章 函数','第6节 对数与对数函数');
  if(has(/幂函数|二次函数/)) return pick('第三章 函数','第4节 二次函数与幂函数');
  if(has(/奇偶性|奇函数|偶函数|周期性|对称性|对称轴|对称中心/)) return pick('第三章 函数','第3节 函数的奇偶性、周期性、对称性');
  if(has(/函数.*单调|单调性|函数.*最值/)) return pick('第三章 函数','第2节 函数的单调性与最值');
  if(has(/函数图象|图象变换|图像变换/)) return pick('第三章 函数','第7节 函数的图象');
  if(has(/函数模型|实际应用|增长率|拟合/)) return pick('第三章 函数','第9节 函数模型及其应用');
  if(has(/定义域|值域|函数的概念|映射/)) return pick('第三章 函数','第1节 函数的概念');
  if(has(/基本不等式|均值不等式|均值定理/)) return pick('第二章 不等式','第2节 基本不等式及其应用');
  if(has(/一元二次不等式|二次方程|判别式/)) return pick('第二章 不等式','第3节 二次函数与一元二次方程、不等式');
  if(has(/不等式|等式.*性质/)) return pick('第二章 不等式','第1节 等式与不等式的性质');
  if(has(/充分条件|必要条件|命题|全称量词|存在量词|逻辑用语/)) return pick('第一章 集合与常用逻辑用语','第2节 常用逻辑用语');
  if(has(/集合|交集|并集|补集|子集|Venn|venn/)) return pick('第一章 集合与常用逻辑用语','第1节 集合');
  if(has(/数量积|向量.*夹角|向量.*垂直/)) return pick('第六章 平面向量与复数','第3节 平面向量的数量积及其应用');
  if(has(/向量.*坐标|基底|基本定理/)) return pick('第六章 平面向量与复数','第2节 平面向量基本定理及坐标表示');
  if(has(/平面向量|向量|共线向量/)) return pick('第六章 平面向量与复数','第1节 平面向量的概念及线性运算');
  if(has(/条件概率|全概率|伯努利|二项分布/)) return pick('第十一章 概率与统计','第2节 条件概率、全概率公式、n重伯努利试验与二项分布');
  if(has(/随机变量.*均值|随机变量.*方差|期望/)) return pick('第十一章 概率与统计','第4节 离散型随机变量的均值与方差');
  if(has(/分布列|超几何分布|离散型随机变量/)) return pick('第十一章 概率与统计','第3节 离散型随机变量及其分布列、超几何分布');
  if(has(/抽样|分层抽样|简单随机抽样/)) return pick('第十一章 概率与统计','第5节 随机抽样');
  if(has(/平均数|中位数|方差|标准差|频率分布|样本.*总体|统计图|百分位数/)) return pick('第十一章 概率与统计','第6节 用样本估计总体');
  if(has(/概率|随机事件|古典概型|互斥|独立事件/)) return pick('第十一章 概率与统计','第1节 随机事件与古典概型');
  // Broad old labels as a conservative fallback.
  const broad=givenChapter+String(raw.topic||'');
  if(/三角/.test(broad)) return pick('第五章 三角函数与解三角形','第4节 三角函数的图象与性质');
  if(/向量|复数/.test(broad)) return pick('第六章 平面向量与复数',/复数/.test(broad)?'第4节 复数':'第1节 平面向量的概念及线性运算');
  if(/数列/.test(broad)) return pick('第七章 数列','第1节 数列的概念及简单表示');
  if(/立体|空间/.test(broad)) return pick('第八章 立体几何与空间向量','第2节 空间点、线、面的位置关系');
  if(/解析几何|圆锥曲线/.test(broad)) return pick('第九章 平面解析几何','第1节 直线的方程');
  if(/概率|统计/.test(broad)) return pick('第十一章 概率与统计','第1节 随机事件与古典概型');
  if(/函数|导数/.test(broad)) return pick('第三章 函数','第1节 函数的概念');
  return {chapter:'其他',section:'其他'};
}

function cleanQuestionBody(b) {
  const tags = Array.isArray(b.tags)
    ? b.tags.map(x => String(x).trim()).filter(Boolean).slice(0, 20)
    : String(b.tags || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean).slice(0, 20);
  const tax = inferTaxonomy({...b,tags});
  return {
    title: String(b.title || '').trim().slice(0, 200),
    type: String(b.type || '解答题').trim().slice(0, 50),
    grade: String(b.grade || '高三').trim().slice(0, 50),
    difficulty: String(b.difficulty || '中档').trim().slice(0, 50),
    topic: String(b.topic || '其他').trim().slice(0, 100),
    chapter: String(tax.chapter || '其他').trim().slice(0, 120),
    section: String(tax.section || '其他').trim().slice(0, 160),
    source: String(b.source || '手工录入').trim().slice(0, 300),
    examNumber: String(b.examNumber || '').trim().slice(0, 40),
    tags,
    stem: String(b.stem || ''),
    answer: String(b.answer || ''),
    solution: String(b.solution || ''),
    stemImages: cleanImages(b.stemImages),
    solutionImages: cleanImages(b.solutionImages),
    layout: cleanLayout(b.layout)
  };
}
function questionFromRow(r) {
  return {
    id: r.id, title: r.title, type: r.type, grade: r.grade,
    difficulty: r.difficulty, topic: r.topic, chapter: r.chapter || r.topic, section: r.section || r.topic || '其他', source: r.source, examNumber: r.exam_number || '',
    tags: r.tags || [], stem: r.stem, answer: r.answer, solution: r.solution,
    stemImages: r.stem_images || [], solutionImages: r.solution_images || [], layout: r.layout || {},
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
      chapter TEXT NOT NULL DEFAULT '其他',
      section TEXT NOT NULL DEFAULT '其他',
      source TEXT NOT NULL,
      exam_number TEXT NOT NULL DEFAULT '',
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      stem TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      solution TEXT NOT NULL DEFAULT '',
      stem_images JSONB NOT NULL DEFAULT '[]'::jsonb,
      solution_images JSONB NOT NULL DEFAULT '[]'::jsonb,
      layout JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Upgrade existing databases first, then create indexes that depend on new columns.
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS stem_images JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS chapter TEXT NOT NULL DEFAULT '其他'`);
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT '其他'`);
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS exam_number TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS solution_images JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`UPDATE questions SET chapter=topic WHERE chapter='其他' OR chapter=''`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_questions_updated_at ON questions(updated_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_questions_chapter ON questions(chapter)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_questions_section ON questions(section)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_questions_source ON questions(source)`);

  // v1.4: classify existing questions into the new fixed 章 → 节 taxonomy using title/topic/stem/solution/tags.
  const existingTax = await pool.query(`SELECT id,title,topic,chapter,section,stem,solution,tags FROM questions`);
  for (const row of existingTax.rows) {
    const t = inferTaxonomy(row);
    if (t.chapter !== row.chapter || t.section !== row.section) {
      await pool.query(`UPDATE questions SET chapter=$2, section=$3 WHERE id=$1`, [row.id,t.chapter,t.section]);
    }
  }

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
      const { rows } = await pool.query(`INSERT INTO questions(id,title,type,grade,difficulty,topic,chapter,section,source,exam_number,tags,stem,answer,solution,stem_images,solution_images,layout,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,$18) RETURNING *`,
        [id,q.title,q.type,q.grade,q.difficulty,q.topic,q.chapter,q.section,q.source,q.examNumber,JSON.stringify(q.tags),q.stem,q.answer,q.solution,JSON.stringify(q.stemImages),JSON.stringify(q.solutionImages),JSON.stringify(q.layout||{}),u.id]);
      const row = rows[0]; row.created_by_name=u.name; row.updated_by_name=u.name;
      return json(res, 201, { question: questionFromRow(row) });
    }
    if (url.pathname === '/api/import/questions' && req.method === 'POST') {
      const u = await requireUser(req, res); if (!u) return;
      const b = await readBody(req);
      const items = Array.isArray(b.questions) ? b.questions : [];
      const onDuplicate = b.onDuplicate === 'replace' ? 'replace' : 'skip';
      if (!items.length) return json(res, 400, { error: '导入文件中没有题目' });
      if (items.length > 500) return json(res, 400, { error: '一次最多导入 500 道题' });
      const summary = { total: items.length, imported: 0, replaced: 0, skipped: 0, failed: 0, errors: [] };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i=0;i<items.length;i++) {
          try {
            const raw = items[i] || {};
            const q = cleanQuestionBody(raw);
            if (!q.title || !q.stem) throw new Error('缺少标题或题干');
            const requestedId = String(raw.id || '').trim();
            const id = requestedId && /^[A-Za-z0-9_.:-]{3,120}$/.test(requestedId) ? requestedId : `Q-${Date.now()}-${i}-${crypto.randomBytes(2).toString('hex')}`;
            const exists = await client.query('SELECT id FROM questions WHERE id=$1', [id]);
            if (exists.rows[0]) {
              if (onDuplicate === 'skip') { summary.skipped++; continue; }
              await client.query(`UPDATE questions SET title=$2,type=$3,grade=$4,difficulty=$5,topic=$6,chapter=$7,section=$8,source=$9,exam_number=$10,tags=$11::jsonb,stem=$12,answer=$13,solution=$14,stem_images=$15::jsonb,solution_images=$16::jsonb,layout=$17::jsonb,updated_by=$18,updated_at=NOW() WHERE id=$1`,
                [id,q.title,q.type,q.grade,q.difficulty,q.topic,q.chapter,q.section,q.source,q.examNumber,JSON.stringify(q.tags),q.stem,q.answer,q.solution,JSON.stringify(q.stemImages),JSON.stringify(q.solutionImages),JSON.stringify(q.layout||{}),u.id]);
              summary.replaced++;
            } else {
              await client.query(`INSERT INTO questions(id,title,type,grade,difficulty,topic,chapter,section,source,exam_number,tags,stem,answer,solution,stem_images,solution_images,layout,created_by,updated_by)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,$18)`,
                [id,q.title,q.type,q.grade,q.difficulty,q.topic,q.chapter,q.section,q.source,q.examNumber,JSON.stringify(q.tags),q.stem,q.answer,q.solution,JSON.stringify(q.stemImages),JSON.stringify(q.solutionImages),JSON.stringify(q.layout||{}),u.id]);
              summary.imported++;
            }
          } catch (e) {
            summary.failed++;
            summary.errors.push({ index:i+1, message:String(e.message||e).slice(0,180) });
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally { client.release(); }
      return json(res, 200, summary);
    }
    const qm = url.pathname.match(/^\/api\/questions\/([^/]+)$/);
    if (qm && req.method === 'PUT') {
      const u = await requireUser(req, res); if (!u) return;
      const q = cleanQuestionBody(await readBody(req));
      if (!q.title || !q.stem) return json(res, 400, { error: '请至少填写标题和题干' });
      const { rows } = await pool.query(`UPDATE questions SET title=$2,type=$3,grade=$4,difficulty=$5,topic=$6,chapter=$7,section=$8,source=$9,exam_number=$10,tags=$11::jsonb,stem=$12,answer=$13,solution=$14,stem_images=$15::jsonb,solution_images=$16::jsonb,layout=$17::jsonb,updated_by=$18,updated_at=NOW() WHERE id=$1 RETURNING *`,
        [decodeURIComponent(qm[1]),q.title,q.type,q.grade,q.difficulty,q.topic,q.chapter,q.section,q.source,q.examNumber,JSON.stringify(q.tags),q.stem,q.answer,q.solution,JSON.stringify(q.stemImages),JSON.stringify(q.solutionImages),JSON.stringify(q.layout||{}),u.id]);
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
