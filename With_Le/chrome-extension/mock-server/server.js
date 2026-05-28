const http = require('http');
const fs = require('fs');
const path = require('path');

const resume = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test-resume.json'), 'utf-8'));
const port = 3000;

const SCAN_DIR = path.join(__dirname, 'scans');
if (!fs.existsSync(SCAN_DIR)) fs.mkdirSync(SCAN_DIR, { recursive: true });

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('payload-too-large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status);
  res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
}

function sanitizeForFilename(str) {
  return (str || 'page').replace(/[^a-z0-9\-_.]+/gi, '_').slice(0, 60);
}

function matchFieldsHandler(body) {
  const { fields = [], resume: resumeData = {}, sections = [] } = body;
  console.log(`[POST] /api/match-fields -> ${fields.length} fields, ${sections.length} sections`);

  const mappings = {};
  const skipped = [];
  const sectionActions = {};

  for (const field of fields) {
    const label = (field.label || '').toLowerCase();
    const id = (field.fieldId || '').toLowerCase();

    if (label.includes('姓名') || label.includes('name') || id.includes('name')) {
      mappings[field.fieldId] = resumeData.name;
    } else if (label.includes('邮箱') || label.includes('email') || id.includes('email')) {
      mappings[field.fieldId] = resumeData.email;
    } else if (label.includes('手机') || label.includes('phone') || id.includes('phone')) {
      mappings[field.fieldId] = resumeData.phone;
    } else if (label.includes('性别') || label.includes('gender') || id.includes('gender')) {
      mappings[field.fieldId] = resumeData.gender;
    } else if (label.includes('出生') || label.includes('birth') || id.includes('birth')) {
      mappings[field.fieldId] = resumeData.birth;
    } else if (label.includes('学校') || label.includes('school') || id.includes('school')) {
      mappings[field.fieldId] = resumeData.education?.[0]?.school || '';
    } else if (label.includes('学历') || label.includes('degree') || id.includes('degree')) {
      mappings[field.fieldId] = resumeData.education?.[0]?.degree || '';
    } else if (label.includes('专业') || label.includes('major') || id.includes('major')) {
      mappings[field.fieldId] = resumeData.education?.[0]?.major || '';
    } else if (label.includes('技能') || label.includes('skill') || id.includes('skill')) {
      mappings[field.fieldId] = resumeData.skills;
    } else if (label.includes('自我') || label.includes('intro') || id.includes('intro') || id.includes('self')) {
      mappings[field.fieldId] = resumeData.self_intro;
    } else if (field.type === 'file' || label.includes('附件') || label.includes('上传')) {
      skipped.push(field.label || field.fieldId);
    } else {
      skipped.push(field.label || field.fieldId);
    }
  }

  if (resumeData.education && resumeData.education.length > 1) {
    for (const sec of sections) {
      if (sec.name && sec.name.includes('教育') && sec.addButton) {
        const need = resumeData.education.length - sec.currentCount;
        if (need > 0) sectionActions[sec.name] = `add_${need}`;
      }
    }
  }

  console.log(`  -> ${Object.keys(mappings).length} mappings, ${Object.keys(sectionActions).length} section actions, ${skipped.length} skipped`);
  return { mappings, skipped, sectionActions };
}

async function pageFieldsSaveHandler(body) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const host = (() => {
    try { return new URL(body.url || '').host; } catch (_) { return 'unknown'; }
  })();
  const fileName = `${id}__${sanitizeForFilename(host)}.json`;
  const filePath = path.join(SCAN_DIR, fileName);
  const record = {
    id,
    savedAt: new Date().toISOString(),
    ...body,
  };
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  console.log(`[POST] /api/page-fields -> saved ${fileName} (${body && body.fieldCount || 0} fields)`);
  return { id, path: path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/'), fieldCount: body.fieldCount || 0 };
}

function pageFieldsListHandler() {
  const files = fs.readdirSync(SCAN_DIR).filter(f => f.endsWith('.json'));
  const items = files.map(f => {
    const stat = fs.statSync(path.join(SCAN_DIR, f));
    return { file: f, size: stat.size, mtime: stat.mtime };
  }).sort((a, b) => b.mtime - a.mtime);
  return { count: items.length, items };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return send(res, 200, '');

  try {
    if (req.method === 'GET' && req.url.startsWith('/api/resume/')) {
      console.log(`[GET] ${req.url} -> returning resume`);
      return send(res, 200, resume);
    }

    if (req.method === 'POST' && req.url === '/api/match-fields') {
      const body = await readJsonBody(req);
      return send(res, 200, matchFieldsHandler(body));
    }

    if (req.method === 'POST' && req.url === '/api/page-fields') {
      const body = await readJsonBody(req);
      const result = await pageFieldsSaveHandler(body);
      return send(res, 200, result);
    }

    if (req.method === 'GET' && req.url === '/api/page-fields/list') {
      return send(res, 200, pageFieldsListHandler());
    }

    if (req.method === 'GET' && req.url.startsWith('/api/page-fields/')) {
      const file = decodeURIComponent(req.url.replace('/api/page-fields/', ''));
      const safe = path.basename(file);
      const fp = path.join(SCAN_DIR, safe);
      if (!fs.existsSync(fp)) return send(res, 404, { error: 'not-found' });
      return send(res, 200, fs.readFileSync(fp, 'utf-8'));
    }

    send(res, 404, { error: 'not-found' });
  } catch (err) {
    console.error('handler error:', err);
    send(res, 500, { error: err.message || 'internal-error' });
  }
});

server.listen(port, () => {
  console.log(`Mock backend running at http://localhost:${port}/api`);
  console.log(`Resume data: ${resume.name}`);
  console.log(`Scans dir: ${SCAN_DIR}`);
  console.log(`Press Ctrl+C to stop`);
});
