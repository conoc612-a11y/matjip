/**
 * identity.js — **회사 하나를 여러 출처로 해석하는 다리**.  〔20260906 신규〕
 *
 * 왜 있나
 *   사업자등록증 조회 모달 안에 이미 이런 연쇄가 살아 있었다 —
 *     상호 → (금융위) crno → 재무·지배구조 / 사업자번호 앞6자리 → 국민연금 /
 *     상호 → 공정위 가맹본부 / 상호 → 키스콘 행정처분·폐업
 *   이건 모달 기능이 아니라 **신원 해석 엔진**인데, **모달 하나에 갇혀 있었다.**
 *   사용자가 사업자번호를 손으로 칠 때만 돌았다.
 *   🔑 사용자 방침(2026-09-05): "길찾기뿐 아니라 **건물 팝업·검색창에도** 같은 방법으로."
 *   → 밖으로 꺼내 아무 화면에서나 부를 수 있게 한다.
 *
 * 🔴 **판정을 boolean 으로 만들지 마라.** 이 앱의 차별점은 "확실하지 않으면 확실하지
 *    않다고 말한다" 는 것이다. 다른 부동산 앱은 첫 결과를 정답인 척 보여준다.
 *    실측: 키스콘 동명 업체가 **8,029곳**이다. `(주)대영건설` 은 31곳, `현대건설(주)` 는 5곳.
 *    ⛔ 사업자번호 없이 상호만으로 좁혀 놓고 "이 회사다" 라고 쓰지 마라.
 *
 * 의존: `js/joinkey.js`(먼저 로드해야 한다)
 */
(function (g) {
  'use strict';

  const KEY = g.mjNameKey;
  const BUCKET = g.mjBucket;
  if (!KEY) { g.console && console.error('identity.js: joinkey.js 를 먼저 로드해야 합니다.'); return; }

  // ── 키스콘 시공사 리스크 색인 ────────────────────────────────────
  // 🔴 상류(키스콘 API)가 **업체명 검색을 안 받는다** — 조건이 공시기간+지역뿐이다.
  //    그래서 `tools/collect_kiscon.js` 가 14.5만 건을 미리 받아 이름으로 뒤집어 뒀다.
  //    ⛔ 실시간 조회로 바꾸려 하지 마라. 불가능하다.
  const RISK_DIR = 'kiscon/';
  const RISK_BUCKETS = 512;
  const _cache = new Map();          // 버킷 번호 → 덩이(또는 null)

  /**
   * 상호로 행정처분·폐업 이력을 찾는다.
   * @param {string} name  상호
   * @param {string} bizno 사업자등록번호(있으면 동명업체를 가른다)
   * @param {Function} cb  결과 또는 null(색인이 아직 없을 때)
   */
  function risk(name, bizno, cb) {
    const key = KEY(name);
    if (!key) { cb(null); return; }
    const b = BUCKET(key, RISK_BUCKETS);
    const use = (bk) => {
      if (!bk) { cb(null); return; }
      const rows = bk[key] || [];
      const bz = String(bizno || '').replace(/\D/g, '');
      const nums = new Set(rows.map((r) => String(r.b || '').replace(/\D/g, '')).filter(Boolean));
      const same = bz ? rows.filter((r) => String(r.b || '').replace(/\D/g, '') === bz) : [];
      cb({
        rows,
        sameBizno: same,
        dup: nums.size,
        matchedByBizno: !!(bz && same.length),
        // 🔑 화면이 "얼마나 믿을 만한가" 를 그대로 쓸 수 있게 판정을 함께 준다.
        confidence: (bz && same.length) ? 'bizno' : (nums.size > 1 ? 'name-ambiguous' : 'name'),
      });
    };
    if (_cache.has(b)) { use(_cache.get(b)); return; }
    // 🔴 **통신 실패는 캐시하지 마라.** 예전엔 `.catch(() => null)` 뒤에 무조건
    //    `_cache.set(b, j)` 를 해서, 네트워크가 한 번 흔들리면 그 버킷이 세션 내내
    //    '이력 없음' 으로 굳었다 — 실제로는 행정처분이 있는 시공사인데 조용히 깨끗해 보인다.
    //    404(버킷 파일이 아예 없음)만 정상 '없음' 으로 보고 캐시한다.
    fetch(RISK_DIR + 'risk_' + b + '.json')
      .then((r) => {
        if (r.ok) return r.json();
        if (r.status === 404) return null;              // 정상 '없음'
        throw new Error('HTTP ' + r.status);            // 일시 장애 — 아래 catch 로
      })
      .then((j) => { _cache.set(b, j); use(j); })
      .catch(() => { use(null); });                     // 캐시하지 않는다 → 다음에 다시 묻는다
  }

  // ── 시공사 리스크 점수 ───────────────────────────────────────────
  // 왜 점수인가: 팝업에 처분 73건을 나열할 수는 없다. **한 눈에 보이는 신호**가 필요하다.
  //
  // ⚠️ 이 점수는 **우리가 만든 것**이지 제공기관이 준 등급이 아니다 — 화면에 그렇게 밝힌다.
  // 🔴 가중치 근거(실측한 처분 종류에서 뽑았다):
  //    등록말소 > 영업정지(일수) > 과징금(금액) > 과태료 > 자진반납
  //    ⛔ **가처분으로 효력이 멈춘 처분(`pd`)은 세지 않는다.** 법원이 멈춘 것을 우리가
  //       살려 두면 사실과 다르다(실측: 삼환기업 과징금이 그랬다).
  //    ⚠️ **최근 3년에 가중**한다. 2003년 자진반납을 오늘 리스크로 읽으면 안 된다.
  const PENALTY_W = [
    // ⛔ 등록말소를 영업정지와 같은 무게로 두지 마라 — 등록말소는 **회사가 끝나는 것**이다.
    //    한 번 같이 뒀더니 '영업정지 2개월(16)' 이 '등록말소(10)' 보다 무거워졌다.
    [/등록말소/, 25],
    [/영업정지/, 10],           // + 정지 일수만큼 아래에서 더한다
    [/과징금/, 4],
    [/과태료/, 1],
    [/시정명령|경고/, 1],
    [/자진반납|반납/, 0],      // 스스로 접은 것 — 제재가 아니다
  ];
  function scoreOf(rows) {
    const nowY = new Date().getFullYear();
    let score = 0; let recent = 0; let worst = '';
    let pen = 0; let ces = 0;

    // 🔴 **같은 처분이 반복되는 걸 그대로 더하지 마라.** 한 공고에 동일 처분이 수십 건
    //    들어오는 데이터다(실측: 하이엠솔루텍 과태료 66건, 같은 날·같은 공고번호).
    //    그냥 곱하면 **과태료 66건(66점)이 영업정지 2개월(16점)을 눌러 버린다** —
    //    실제 심각도와 순서가 뒤집힌다. → 반복은 `1 + log2(n)` 으로만 키운다.
    //    ⛔ 그렇다고 1건으로 접지도 마라. 상습이라는 신호 자체는 남겨야 한다.
    const groups = new Map();
    for (const r of rows) {
      if (r.k === 'c') { ces++; continue; }
      pen++;
      if (r.pd) continue;                       // ⛔ 가처분으로 멈춘 처분은 빼고 센다
      const k = [r.d, r.pn, r.pw, r.ps, r.pe].join('|');
      const g = groups.get(k);
      if (g) g.n += 1; else groups.set(k, { r, n: 1 });
    }

    for (const { r, n } of groups.values()) {
      const y = Number(String(r.d || '').slice(0, 4)) || 0;
      const age = nowY - y;
      let w = 1;
      for (const [re, v] of PENALTY_W) if (re.test(r.pn || '')) { w = v; break; }
      if (!w) continue;
      // 영업정지는 **일수**만큼 무겁다.
      if (/영업정지/.test(r.pn || '') && r.ps && r.pe) {
        const d = (Date.parse(fmtDate(r.pe)) - Date.parse(fmtDate(r.ps))) / 86400000;
        if (d > 0) w += Math.min(20, Math.round(d / 30) * 3);
      }
      // 최근 3년은 그대로, 그 뒤로는 급격히 가볍게 — 10년 넘은 건 거의 안 센다.
      const decay = age <= 3 ? 1 : age <= 7 ? 0.4 : age <= 12 ? 0.15 : 0.05;
      const repeat = 1 + Math.log2(n);          // 1건=1 · 8건=4 · 66건≈7
      score += w * decay * repeat;
      if (age <= 3) recent += n;
      if (w >= 10 && !worst) worst = r.pn;
    }
    return {
      score: Math.round(score),
      pen, ces, recent, worst,
      // 등급은 **네 칸**뿐이다. 더 잘게 나누면 정밀해 보이지만 근거가 없다.
      level: score >= 20 ? 'high' : score >= 6 ? 'mid' : score > 0 ? 'low' : 'none',
    };
  }
  const fmtDate = (v) => String(v || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');

  // ── 불확실성 표시 ────────────────────────────────────────────────
  // 🔑 "확실하지 않으면 확실하지 않다고 말한다" 를 **한 곳에서** 만든다.
  //    ⛔ 화면마다 다른 문구로 적지 마라 — 사용자가 신뢰도를 비교할 수 없게 된다.
  const UNCERTAIN = {
    bizno: null,                                  // 사업자번호로 좁혔다 — 덧붙일 말이 없다
    name: null,                                   // 동명이 없다
    'name-ambiguous': (n) => `같은 상호가 <b>${n}곳</b>입니다 — 아래는 그 전부입니다.`
      + ' 사업자등록번호를 함께 넣으면 한 곳으로 좁혀집니다.',
  };
  function uncertainHtml(res) {
    const f = res && UNCERTAIN[res.confidence];
    if (!f) return '';
    return '<div class="mj-uncertain" style="color:#e8590c;font-size:12px;margin-top:3px;">⚠️ '
      + f(res.dup) + '</div>';
  }

  /**
   * 시공사 배지 한 줄. 팝업 옆에 조용히 붙인다.
   * ⚠️ **깨끗한 것이 대부분**이라, 뜨는 것 자체가 신호가 되게 `none` 이면 빈 문자열을 준다.
   */
  function riskBadge(res) {
    if (!res || !res.rows.length) return '';
    const rows = res.matchedByBizno ? res.sameBizno : res.rows;
    const s = scoreOf(rows);
    if (s.level === 'none' && !s.ces) return '';
    const color = { high: '#c92a2a', mid: '#e8590c', low: '#868e96', none: '#868e96' }[s.level];
    const label = s.ces && !s.pen ? `폐업 공시 ${s.ces}건`
      : `행정처분 ${s.pen}건${s.recent ? ` (최근 3년 ${s.recent}건)` : ''}${s.ces ? ` · 폐업 ${s.ces}건` : ''}`;
    return `<span class="mj-risk" style="display:inline-block;font-size:11px;padding:1px 6px;`
      + `border-radius:9px;background:${color};color:#fff;">${label}</span>`;
  }

  g.mjIdentity = { risk, scoreOf, riskBadge, uncertainHtml, fmtDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = g.mjIdentity;
}(typeof globalThis !== 'undefined' ? globalThis : this));
