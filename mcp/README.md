# 맛집 탐방 MCP 서버

맛집·추천 데이터를 AI 클라이언트(Claude Desktop/Code 등)에 **도구**로 노출한다.

## 도구
- `list_restaurants` — 서울 맛집 목록 조회
- `recommend(spicy_level, flavor_tags[], situation_tags[])` — 취향 기반 추천

## 설치 & 실행
```
cd mcp
npm install
node server.js      # stdio 방식 (직접 실행보다 아래 등록으로 사용)
```

## AI 클라이언트 등록 (예: Claude Desktop)
설정 파일의 `mcpServers`에 추가:
```json
{
  "mcpServers": {
    "matjip": {
      "command": "node",
      "args": ["<이 폴더 절대경로>/server.js"]
    }
  }
}
```
등록 후 "맛집 추천 도구로 매운 회식 맛집 알려줘" 처럼 물으면 AI가 `recommend`를 호출한다.

접속 정보는 환경변수 `SUPABASE_URL`, `SUPABASE_ANON_KEY`로 덮어쓸 수 있다(기본값은 restaurant-guide 프로젝트).
