// 맛집 탐방 MCP 서버 — 맛집·추천 데이터를 AI 클라이언트에 도구로 노출.
// 실행: node mcp/server.js  (stdio 방식, AI 클라이언트 설정에 등록해서 사용)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchRestaurants, score } from "../tools/recommend.js";

const server = new McpServer({ name: "matjip", version: "1.0.0" });

server.tool(
  "list_restaurants",
  "서울 맛집 목록을 조회한다",
  {},
  async () => {
    const rs = await fetchRestaurants();
    return { content: [{ type: "text", text: rs.map((r) => `${r.id}. ${r.name} [${(r.tags || []).join(',')}] (${r.category})`).join('\n') }] };
  }
);

server.tool(
  "recommend",
  "취향(매운맛·맛태그·상황태그)으로 맛집을 추천한다",
  {
    spicy_level: z.number().min(0).max(5).default(2),
    flavor_tags: z.array(z.string()).default([]),
    situation_tags: z.array(z.string()).default([]),
  },
  async (t) => {
    const rs = await fetchRestaurants();
    const ranked = rs.map((r) => ({ ...r, ...score(r, t) }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 5);
    return { content: [{ type: "text", text: ranked.map((r) => `${r.score}점 ${r.name} [${(r.tags || []).join(',')}]${r.hits.length ? ' ← ' + r.hits.join(',') : ''}`).join('\n') }] };
  }
);

await server.connect(new StdioServerTransport());
