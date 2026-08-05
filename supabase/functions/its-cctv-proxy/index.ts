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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const p = new URL(req.url).searchParams;
  const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
  const radius = Number(p.get("radius")) || 0.03; // 도(度) 단위, 약 3km
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: "lat/lng 파라미터가 필요합니다." }, 400);
  }
  const key = Deno.env.get("ITS_CCTV_KEY");
  if (!key) return json({ error: "서버에 ITS_CCTV_KEY가 설정되지 않았습니다." }, 500);

  const minX = lng - radius, maxX = lng + radius, minY = lat - radius, maxY = lat + radius;
  // 고속도로(ex)·국도(its) 두 유형을 함께 조회해 합친다.
  // 주의(2026-08-05 실측): 로컬(직접 curl)에선 2초 내 응답하지만, 이 Edge Function
  // (Deno Deploy) 환경에서는 응답이 아예 없이 멈춘다 — ITS 서버가 클라우드 아웃바운드
  // IP대역을 막고 있을 가능성이 높다(패킷 드랍형 차단은 일반 타임아웃과 구분 안 됨).
  // 그래서 무기한 대기를 막기 위해 각 요청에 8초 타임아웃을 강제한다.
  const types = ["ex", "its"];
  const results: any[] = [];
  let anyTimedOut = false;
  for (const type of types) {
    const q = `apiKey=${key}&type=${type}&cctvType=2&minX=${minX}&maxX=${maxX}&minY=${minY}&maxY=${maxY}&getType=json`;
    const api = `https://openapi.its.go.kr:9443/cctvInfo?${q}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(api, { signal: ctrl.signal });
      const data = await r.json();
      const arr = data?.response?.data;
      if (Array.isArray(arr)) results.push(...arr);
    } catch (e) {
      if ((e as Error).name === "AbortError") anyTimedOut = true;
      // 한쪽 type이 실패해도 다른 쪽 결과는 반환한다.
    } finally {
      clearTimeout(timer);
    }
  }
  return json({
    count: results.length,
    timedOut: anyTimedOut,
    items: results.map((d: any) => ({
      name: d.cctvname,
      url: d.cctvurl,
      lat: Number(d.coordy),
      lng: Number(d.coordx),
      format: d.cctvformat,
    })),
  });
});
