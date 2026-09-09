/**
 * joinkey.js — **데이터를 서로 잇는 키**를 만드는 단 하나의 자리.  〔20260906 신규〕
 *
 * 왜 있나
 *   matjip 은 API 120개를 붙였다. 남은 가치는 개별 연동이 아니라 **조인**에 있는데,
 *   조인의 성패는 "같은 회사인가 / 같은 주소인가" 를 판정하는 **문자열 정규화** 하나에 달렸다.
 *
 * 🔴 **그 함수가 셋이었고, 서로 달랐다**(2026-09-06 실측 · 전부 land.html 안).
 *      `norm0`(1570줄) · `nokey`(1735줄) — 같은 내용을 복붙한 쌍둥이.
 *        (1567줄 주석이 이유를 자백한다: "nokey 는 아래에서 선언된다 — 여기선 아직 없다")
 *      `kisKey`(8673줄) — 키스콘용. **판정이 달랐다**:
 *        nokey  : '(주)대우건설' → '주대우건설' · '대우건설(주)' → '대우건설주'  ← 둘이 안 맞는다
 *        kisKey : 둘 다          → '대우건설'                                   ← 이쪽이 맞다
 *      같은 화면이 같은 회사를 다르게 판정하고 있었다.
 *   ⛔ **여기 말고 다른 데서 이름 정규화를 새로 짓지 마라.** 그게 위 사고의 원인이다.
 *
 * 🔴 **`mjNameKey` 를 고치면 키스콘 색인을 다시 만들어야 한다.**
 *      `kiscon/risk_<n>.json` 의 **버킷 번호가 이 함수로 계산된다**. 함수만 바꾸면
 *      조회가 통째로 0건이 되는데 **오류는 안 난다**(조용한 실패).
 *      → `node tools/build_kiscon_index.js` (수집 원본으로 다시 만든다 · 호출 0회)
 *
 * 브라우저와 Node 양쪽에서 쓴다 — 수집기와 화면이 **같은 함수**를 써야 뜻이 있다.
 *   화면 : <script src="js/joinkey.js"> → window.mjNameKey(...)
 *   수집기: const { mjNameKey } = require('../js/joinkey.js')
 */
(function (g) {
  'use strict';

  // 법인격 표기를 **통째로** 걷어낸다. ⚠️ 순서가 중요하다 —
  //   괄호 낱자를 먼저 지우면 '(주)' 가 '주' 로 남아 '주대우건설' 이 된다(옛 `nokey` 의 버그).
  const CORP_PAREN = /[（(]\s*(?:주|유|재|사|주식회사|유한회사|재단법인|사단법인)\s*[)）]/g;
  const CORP_WORD = /주식회사|유한회사|유한책임회사|합자회사|합명회사|재단법인|사단법인|사회복지법인|의료법인/g;
  // ⚠️ `ㆍ`(U+318D 아래아)는 가운뎃점(`·` U+00B7)과 **다른 글자**인데 눈으로 같아 보인다.
  //    키스콘 업종명이 U+318D 를 쓴다(실측). 둘 다 지운다.
  const NOISE = /[\s.,'"’`·ㆍ・‧、／/\\\-_()（）[\]{}［］〔〕【】]/g;

  /**
   * 상호 → 조인 키. 표기가 달라도 같은 회사면 같은 값이 나오게 누른다.
   *
   * 실측으로 확인한 입력들(테스트: `node tools/test_joinkey.js`):
   *   '(주)대우건설' · '대우건설(주)' · '대우건설㈜'        → '대우건설'
   *   '진화전기（주）'  (국민연금에 전각 괄호가 섞여 온다)   → '진화전기'
   *   '하이엠솔루텍주식회사'                                → '하이엠솔루텍'
   */
  function mjNameKey(v) {
    return String(v == null ? '' : v)
      .replace(/[㈜㈱]/g, '')
      .replace(CORP_PAREN, '')
      .replace(CORP_WORD, '')
      .replace(NOISE, '')
      .toLowerCase()
      .trim();
  }

  /** 사업자등록번호 → 숫자 10자리. ⚠️ 국민연금은 **앞 6자리만** 준다(뒤는 마스킹). */
  function mjBizno(v) {
    const d = String(v == null ? '' : v).replace(/\D/g, '');
    return d.length >= 10 ? d.slice(0, 10) : d;
  }

  /** 법인등록번호(crno) → 숫자 13자리. 금융위 재무·지배구조가 이걸로만 좁혀진다. */
  function mjCrno(v) {
    return String(v == null ? '' : v).replace(/\D/g, '').slice(0, 13);
  }

  /**
   * 주소 → 지오코딩 캐시 키.
   * ⚠️ 괄호 안 법정동(`… 42   (도곡동)`)과 층·호는 **좌표를 바꾸지 않는다** → 지운다.
   *    그래야 같은 건물의 다른 호실이 캐시를 함께 쓴다.
   */
  function mjAddrKey(v) {
    return String(v == null ? '' : v)
      .replace(/\([^)]*\)/g, ' ')                 // (도곡동) 같은 꼬리
      .replace(/\s\d+층.*$/, '')                  // 10층, 11층
      .replace(/\s[\d-]+호.*$/, '')               // 101호
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 이름 키 → 버킷 번호. **목록 파일 없이** 어느 조각을 받을지 계산된다.
   * 🔴 이 해시를 바꾸면 색인을 다시 만들어야 한다(위 경고 참고).
   */
  function mjBucket(key, n) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return h % (n || 512);
  }

  /**
   * 두 이름이 같은 회사인가. 반환값이 **판정 강도**다 —
   * ⛔ boolean 으로 쓰지 마라. '포함' 은 '일치' 가 아니다("현대건설" 은 "현대건설기계" 를 문다).
   *   'exact'   두 키가 같다
   *   'partial' 한쪽이 다른 쪽을 포함한다 (화면에 '추정' 이라고 밝혀야 한다)
   *   ''        아니다
   */
  function mjNameMatch(a, b) {
    const x = mjNameKey(a);
    const y = mjNameKey(b);
    if (!x || !y) return '';
    if (x === y) return 'exact';
    if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return 'partial';
    return '';
  }

  const API = { mjNameKey, mjBizno, mjCrno, mjAddrKey, mjBucket, mjNameMatch };
  for (const k of Object.keys(API)) g[k] = API[k];
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
}(typeof globalThis !== 'undefined' ? globalThis : this));
