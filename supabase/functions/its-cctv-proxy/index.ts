// ITS 국가교통정보센터 CCTV 프록시 — Supabase Edge Function (Deno)
//
// 요청 형식(공식 스펙 + 실사용 예시로 확인): https://openapi.its.go.kr:9443/cctvInfo
//   ?apiKey=<키>&type=ex|its&cctvType=2&minX=&maxX=&minY=&maxY=&getType=json
//   type: ex=고속도로, its=국도  |  cctvType=2 = 실시간 영상 스트리밍(확인됨, cctvurl에 재생 가능한 스트림 URL)
// 응답의 response.data[] 각 항목에 cctvurl(영상 스트림 URL)이 들어있다.
//
// 클라이언트는 지도 중심 lat/lng만 보내면, 그 주변 반경으로 bbox를 만들어 조회한다.
//
// ── 배포 방법 ─────────────────────────────────────────
//   supabase functions deploy its-cctv-proxy --no-verify-jwt
// 호출 예:
//   .../its-cctv-proxy?lat=37.49&lng=126.96&radius=0.03
// ────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

// 마지막으로 성공한 조회 결과(같은 인스턴스가 살아 있는 동안만 유효).
let lastGood: { at: number; rows: any[] } | null = null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const p = new URL(req.url).searchParams;
  const key = Deno.env.get("ITS_CCTV_KEY");
  if (!key) return json({ error: "서버에 ITS_CCTV_KEY가 설정되지 않았습니다." }, 500);

  // 지도 화면 범위(bbox)를 그대로 받는 것이 기본. lat/lng+radius 는 예전 호출 호환용.
  // ITS 는 고속도로·국도만 커버해서 도심 한복판엔 CCTV 가 아예 없다(실측: 강남 0건,
  // 서울 전역으로 넓히면 240건). 반경 3km 로 좁게 물으면 대부분 빈 결과가 나오므로
  // 화면에 보이는 범위 전체를 물어야 한다.
  let minX = Number(p.get("minX")), maxX = Number(p.get("maxX"));
  let minY = Number(p.get("minY")), maxY = Number(p.get("maxY"));
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
    const radius = Number(p.get("radius")) || 0.15;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: "bbox(minX/maxX/minY/maxY) 또는 lat/lng 가 필요합니다." }, 400);
    }
    minX = lng - radius; maxX = lng + radius; minY = lat - radius; maxY = lat + radius;
  }
  // 고속도로(ex)·국도(its) 두 유형을 함께 조회해 합친다.
  // 주의(2026-08-05 실측): 로컬(직접 curl)에선 2초 내 응답하지만, 이 Edge Function
  // (Deno Deploy) 환경에서는 응답이 아예 없이 멈춘다 — ITS 서버가 클라우드 아웃바운드
  // IP대역을 막고 있을 가능성이 높다(패킷 드랍형 차단은 일반 타임아웃과 구분 안 됨).
  // 그래서 무기한 대기를 막기 위해 각 요청에 8초 타임아웃을 강제한다.
  // 고속도로(ex)·국도(its)를 병렬로 부른다. 순차로 부르면 앞 요청이 느릴 때 뒤 요청까지
  // 밀려 통째로 타임아웃돼 결과가 0건이 됐다(실측: 같은 요청이 한 번은 0건, 한 번은 240건).
  // Supabase 리전에서 ITS(한국)까지 왕복이 느려 제한 시간도 넉넉히 준다.
  const types = ["ex", "its"];
  let anyTimedOut = false;
  let lastErr = "";
  // 같은 type 을 최대 2번 시도한다. ITS 는 Supabase 리전에서 응답이 들쭉날쭉해
  // 한 번에 성공하지 못하는 경우가 잦다(실측: 동일 요청이 0건/240건/0건).
  const fetchType = async (type: string) => {
    const q = `apiKey=${key}&type=${type}&cctvType=2&minX=${minX}&maxX=${maxX}&minY=${minY}&maxY=${maxY}&getType=json`;
    const api = `https://openapi.its.go.kr:9443/cctvInfo?${q}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch(api, { signal: ctrl.signal });
        const text = await r.text();
        if (p.get("debug")) return { debug: { type, attempt, status: r.status, body: text.slice(0, 300) } };
        const arr = JSON.parse(text)?.response?.data;
        if (Array.isArray(arr) && arr.length) return { rows: arr };
        if (Array.isArray(arr)) return { rows: [] };   // 정상 응답인데 정말 0건
      } catch (e) {
        if ((e as Error).name === "AbortError") anyTimedOut = true;
        lastErr = `${type}#${attempt}: ${(e as Error).name}: ${(e as Error).message}`.slice(0, 200);
      } finally {
        clearTimeout(timer);
      }
    }
    return { rows: [] };
  };
  const settled = await Promise.all(types.map(fetchType));
  if (p.get("debug")) return json({ debug: settled.map((s: any) => s.debug).filter(Boolean) });
  let results: any[] = settled.flatMap((s: any) => s.rows || []);

  // 그래도 비면, 최근에 성공한 결과를 대신 준다. CCTV 위치는 몇 분 단위로 바뀌지 않으므로
  // 빈 지도를 보여주는 것보다 낫다(같은 인스턴스가 살아 있는 동안에만 유효한 캐시).
  if (!results.length && lastGood && Date.now() - lastGood.at < 10 * 60 * 1000) {
    results = lastGood.rows;
  } else if (results.length) {
    lastGood = { at: Date.now(), rows: results };
  }
  return json({
    count: results.length,
    timedOut: anyTimedOut,
    lastErr,
    items: results.map((d: any) => ({
      name: d.cctvname,
      url: d.cctvurl,
      lat: Number(d.coordy),
      lng: Number(d.coordx),
      format: d.cctvformat,
    })),
  });
});
