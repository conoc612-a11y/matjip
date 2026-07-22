---
name: matjip-recommend
description: 사용자의 취향(매운맛·맛·상황)으로 서울 맛집을 추천할 때 사용. Supabase의 mj_restaurants를 조회해 규칙기반 매칭으로 순위와 근거를 만든다.
---
# 맛집 추천 워크플로우

1. 취향을 파악한다 — 매운맛(0~5), 맛 태그(매콤/담백/단짠/새콤/기름진/달콤), 상황 태그(혼밥/회식/데이트/가족모임/친구모임).
2. 아래 CLI를 실행한다 (직접 DB를 뒤지지 말고 CLI를 대신 호출):
   ```
   node tools/matjip-cli.js recommend --spicy <0-5> --flavors <a,b> --situations <c>
   ```
3. 출력 상위 결과를 **근거(일치 태그)** 와 함께 사람이 읽기 좋게 정리해 제시한다.

예) "회식이고 매운 걸 좋아해" → `--spicy 4 --flavors 매콤 --situations 회식` → 금돼지식당(회식·매콤 일치)을 1순위로 추천.
