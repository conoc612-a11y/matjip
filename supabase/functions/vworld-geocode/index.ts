// V-World 지오코딩 프록시 — Supabase Edge Function (Deno)
//
// 왜 필요한가: GitHub Actions 러너 IP는 전부 해외(Azure) 대역이라 V-World가 TCP
//   레벨로 차단(ECONNRESET)해 CI 지오코딩이 캐시 히트분만 성공하고 신규 0건이었다
//   (2026-08-15 실측: CI 5/5 ECONNRESET, Supabase 경유 8회 중 4회 200).
//   V-World는 도메인 잠금 publishable 키라 HTML에 이미 노출돼 있고(land.html JSONP),
//   이 프록시는 서버(미국 IP)에서 중계해 차단된 네트워크를 우회한다.
//
// 배포:
//   supabase functions deploy vworld-geocode --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
// 호출:
//   ?address=서울특별시 서초구 논현로1길 23&type=ROAD
// 응답:
//   200 {"status":"OK","lat":37.5,"lng":127.0}
//   200 {"status":"NOT_FOUND"}
//   502 {"status":"ERROR"}   (재시도 4회 후에도 차단/오류)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

const VWORLD_KEY = Deno.env.get("VWORLD_KEY") || "B2CDEEDD-D622-311B-883B-CC7890E50822";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const address = url.searchParams.get("address") || "";
  const type = url.searchParams.get("type") || "PARCEL";
  if (!address) return json({ status: "ERROR", error: "address 파라미터 필요" }, 400);

  const api = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0`
    + `&crs=EPSG:4326&type=${type}&format=json&key=${VWORLD_KEY}&address=${encodeURIComponent(address)}`;

  // V-World가 Supabase(미국) IP를 간헐적으로 거부한다(실측: 8회 중 4회 502/RST).
  // NOT_FOUND는 확정 실패라 재시도하지 않고, 차단(502/RST)만 백오프로 물러섰다 다시 시도.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(api, { signal: AbortSignal.timeout(20000) });
      if (r.status !== 200) {
        if (attempt < 4) { await new Promise((res) => setTimeout(res, 400 * attempt * attempt)); continue; }
        return json({ status: "ERROR", http: r.status }, 502);
      }
      const j = await r.json();
      const s = j?.response?.status;
      if (s === "OK") {
        const p = j.response.result.point;
        return json({ status: "OK", lat: Number(Number(p.y).toFixed(6)), lng: Number(Number(p.x).toFixed(6)) });
      }
      if (s === "NOT_FOUND") return json({ status: "NOT_FOUND" });
      // 그 외(일시 오류)는 재시도
      if (attempt < 4) { await new Promise((res) => setTimeout(res, 400 * attempt * attempt)); continue; }
      return json({ status: "ERROR", vworld: s }, 502);
    } catch (e) {
      // fetch 실패(ECONNRESET류) — 백오프 재시도
      if (attempt < 4) { await new Promise((res) => setTimeout(res, 400 * attempt * attempt)); continue; }
      return json({ status: "ERROR", error: String(e) }, 502);
    }
  }
  return json({ status: "ERROR" }, 502);
});
