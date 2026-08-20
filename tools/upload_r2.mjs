/**
 * upload_r2.mjs — 경매 사진·PDF 같은 바이너리를 Cloudflare R2로 올린다.
 *
 * 왜 필요한가:
 *  auction_photos/ 는 16,000개가 넘는 jpg 로 300MB 를 넘어섰다. 이걸 git 에 커밋해
 *  GitHub Pages 로 서빙하면 (1) Pages 게시 사이트 1GB 하드 제한에 곧 걸리고,
 *  (2) .git 이 2.5GB 로 불어나 push/clone 이 계속 느려진다. 그래서 바이너리는
 *  git 밖(R2)으로 빼고 저장소엔 메타 JSON 만 남긴다. R2 는 무료 10GB + egress 무료.
 *
 * 사용법:
 *   node tools/upload_r2.mjs                     # auction_photos/ 전체 동기화(이미 올린 건 건너뜀)
 *   node tools/upload_r2.mjs --dir auction_pdfs  # 다른 폴더(감정평가서 PDF 등)
 *   node tools/upload_r2.mjs --force             # 매니페스트 무시하고 전부 재업로드
 *   node tools/upload_r2.mjs --dry-run           # 올릴 목록만 출력
 *
 * 키는 keys.env(gitignored)에서만 읽는다 — 프론트/커밋엔 절대 들어가지 않는다.
 * 필요한 값: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *
 * 오브젝트 키 = 저장소 기준 상대경로(예: auction_photos/서울중앙지방법원_2024타경3528/000241_1.jpg).
 * auction_photos.json 의 file 값과 정확히 같게 맞춘 것 — 그래서 프론트는 앞에
 * 공개 URL(PHOTO_BASE)만 붙이면 되고, JSON 은 손댈 필요가 없다.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AwsClient } from 'aws4fetch';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'tools', '.r2_uploaded.json');
const CONCURRENCY = 8;   // R2 는 여유롭지만 로컬 디스크 읽기가 병목이라 8이면 충분
const RETRIES = 3;

// ── 인자 ──
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SUBDIR = opt('--dir', 'auction_photos');
const FORCE = flag('--force');
const DRY = flag('--dry-run');

// ── 자격증명 로드 ──
// keys.env(로컬) → 환경변수(CI) 순으로 읽고, 환경변수가 있으면 그쪽을 쓴다.
// GitHub Actions 로 사진 수집을 자동화할 때 Secrets 로 주입할 수 있게 한 것.
function loadEnv() {
  const out = {};
  const f = path.join(ROOT, 'keys.env');
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('R2_') && process.env[k]) out[k] = process.env[k];
  }
  return out;
}
function die(msg) { console.error('✖ ' + msg); process.exit(1); }

const env = loadEnv();
for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
  if (!env[k]) die(`keys.env 에 ${k} 가 없습니다. Cloudflare R2 대시보드에서 발급한 값을 넣어주세요.`);
}
const ENDPOINT = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
const aws = new AwsClient({
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto',
});

// ── 파일 수집 ──
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.pdf': 'application/pdf', '.json': 'application/json',
};
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const target = path.join(ROOT, SUBDIR);
if (!fs.existsSync(target)) die(`폴더가 없습니다: ${SUBDIR}`);

// 오브젝트 키는 항상 슬래시 구분 — 윈도우 백슬래시를 변환한다.
const files = walk(target).map((abs) => {
  const key = path.relative(ROOT, abs).split(path.sep).join('/');
  return { abs, key, size: fs.statSync(abs).size };
});

// ── 매니페스트(이미 올린 것) ──
// 키 → 파일크기. 크기가 달라지면 내용이 바뀐 것으로 보고 다시 올린다
// (shrink_auction_photos.py 로 리사이즈한 경우가 여기 걸린다).
let manifest = {};
if (!FORCE && fs.existsSync(MANIFEST)) {
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { manifest = {}; }
}
const todo = files.filter((f) => manifest[f.key] !== f.size);

const totalMB = (todo.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1);
console.log(`${SUBDIR}: 파일 ${files.length}개 중 ${todo.length}개 업로드 대상 (${totalMB}MB)`);
if (!todo.length) { console.log('✔ 이미 최신입니다.'); process.exit(0); }
if (DRY) { todo.slice(0, 20).forEach((f) => console.log('  ' + f.key)); console.log(`  ... 총 ${todo.length}개`); process.exit(0); }

// ── 업로드 ──
// 경로에 한글이 많다 — 세그먼트별 encodeURIComponent 로 서명 URL 을 만든다.
const encKey = (key) => key.split('/').map(encodeURIComponent).join('/');

async function put(f) {
  const body = fs.readFileSync(f.abs);
  const ct = MIME[path.extname(f.abs).toLowerCase()] || 'application/octet-stream';
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await aws.fetch(`${ENDPOINT}/${encKey(f.key)}`, {
        method: 'PUT',
        body,
        headers: {
          'Content-Type': ct,
          // 사진은 사건번호+구분+번호로 파일명이 결정돼 사실상 불변 — 1년 캐시로 Class B 호출을 줄인다.
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Amz-Content-Sha256': crypto.createHash('sha256').update(body).digest('hex'),
        },
      });
      if (res.ok) return true;
      if (attempt === RETRIES) { console.error(`  ✖ ${f.key} — HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); return false; }
    } catch (e) {
      if (attempt === RETRIES) { console.error(`  ✖ ${f.key} — ${e.message}`); return false; }
    }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  return false;
}

let done = 0, ok = 0, fail = 0;
// 매니페스트는 중간에 끊겨도 진행분이 남도록 200개마다 저장한다.
const save = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest));

async function worker(queue) {
  while (queue.length) {
    const f = queue.pop();
    const good = await put(f);
    if (good) { manifest[f.key] = f.size; ok++; } else fail++;
    if (++done % 200 === 0) { save(); process.stdout.write(`\r  ${done}/${todo.length} (실패 ${fail})   `); }
  }
}

const queue = todo.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
save();
console.log(`\n✔ 완료 — 성공 ${ok}, 실패 ${fail}`);
if (fail) {
  console.log('  실패분은 다시 실행하면 재시도합니다(성공분은 매니페스트로 건너뜀).');
  process.exit(1);
}
