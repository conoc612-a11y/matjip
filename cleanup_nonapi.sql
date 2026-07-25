-- [최종 제출 직전 실행] 식당정보 API 외 임의 저장/시드 식당 데이터 삭제
-- 행정안전부 착한가격업소(tags에 '착한가격')만 남기고,
-- 나머지(초기 시드 을지면옥 등 · 카카오/네이버 검색으로 저장 · 수동 추가)를 제거한다.
-- saved_restaurants는 FK(on delete cascade)로 함께 정리됨.
-- 실거래가(realprice_seoul_gg.json)는 별도 파일이라 영향 없음.

delete from mj_restaurants where not ('착한가격' = any(tags));

-- 확인용: 남은 건수
-- select count(*) from mj_restaurants;   -- 착한가격업소만 남아야 함
