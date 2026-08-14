#!/usr/bin/env python3
"""경매 사진 일괄 축소 — GitHub Pages 1GB 한도에 맞추기 위한 것.

왜 필요한가 (2026-08-14 실측):
  수집기가 법원 사이트 원본을 그대로 저장해서 사진 1,125건(38%)만으로 2.4GB가 됐다.
  전량 수집하면 약 6GB. 그런데 **GitHub Pages 게시 사이트는 1GB가 상한**이라 그대로면
  배포 자체가 안 된다. 사진 외 데이터가 69MB 이므로 사진 예산은 최대 955MB.
  장수를 줄이지 않고(사용자 선택) 폭 400px·품질 55 로 낮추면 장당 17KB → 전량 약 690MB,
  사이트 총계 771MB(한도의 75%)로 안전하게 들어간다.

무엇을 하나:
  auction_photos/ 아래 모든 이미지를 폭 MAX_W 이하로 줄이고 JPEG 로 다시 저장한다.
  - 이미 작은 사진은 해상도를 키우지 않는다(업스케일 금지).
  - 결과가 원본보다 크면 원본을 그대로 둔다(작은 GIF 등에서 발생).
  - GIF/PNG 도 JPEG 로 바꾸되 **파일명은 유지**한다 — auction_photos.json 메타와
    land.html 이 그 경로를 그대로 참조하므로 이름이 바뀌면 사진이 깨진다.
    (확장자와 실제 형식이 달라도 브라우저는 내용을 보고 렌더하므로 문제없다.)
  - 재실행 안전: 이미 축소된 파일은 폭이 MAX_W 이하라 다시 줄지 않는다.

사용법:
  python tools/shrink_auction_photos.py [--dry-run] [--max-width 400] [--quality 55]
"""
import argparse
import io
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow 가 필요합니다:  pip install Pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'auction_photos')
EXTS = ('.jpg', '.jpeg', '.png', '.gif', '.bin')


def human(n):
    for u in ('B', 'KB', 'MB', 'GB'):
        if n < 1024 or u == 'GB':
            return f'{n:.1f}{u}'
        n /= 1024


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-width', type=int, default=400)
    ap.add_argument('--quality', type=int, default=55)
    ap.add_argument('--dry-run', action='store_true', help='계산만 하고 파일은 안 바꿈')
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        sys.exit(f'폴더가 없습니다: {SRC}')

    files = []
    for dp, _, names in os.walk(SRC):
        for n in names:
            if n.lower().endswith(EXTS):
                files.append(os.path.join(dp, n))
    files.sort()
    if not files:
        sys.exit('처리할 사진이 없습니다.')

    print(f'대상 {len(files):,}개 · 폭 {args.max_width}px · 품질 {args.quality}'
          + (' · DRY-RUN(파일 안 바꿈)' if args.dry_run else ''))

    before = after = 0
    changed = skipped = failed = 0
    for i, p in enumerate(files, 1):
        try:
            osz = os.path.getsize(p)
            before += osz
            im = Image.open(p)
            im.load()
            im = im.convert('RGB')
            w, h = im.size
            if w > args.max_width:
                im = im.resize((args.max_width, max(1, round(h * args.max_width / w))), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, 'JPEG', quality=args.quality, optimize=True, progressive=True)
            data = buf.getvalue()
            # 원본이 더 작으면 그대로 둔다 — 줄이려다 키우는 일이 없도록.
            if len(data) >= osz:
                after += osz
                skipped += 1
            else:
                after += len(data)
                changed += 1
                if not args.dry_run:
                    tmp = p + '.tmp'
                    with open(tmp, 'wb') as f:
                        f.write(data)
                    os.replace(tmp, p)   # 원자적 교체 — 중간에 죽어도 파일이 깨지지 않는다
        except Exception as e:
            failed += 1
            after += osz
            print(f'  실패: {os.path.relpath(p, ROOT)} — {e}')
        if i % 2000 == 0:
            print(f'  {i:,}/{len(files):,} · 현재까지 {human(before)} → {human(after)}')

    print()
    print(f'축소 {changed:,} · 원본유지 {skipped:,} · 실패 {failed:,}')
    print(f'용량 {human(before)} → {human(after)}  ({after / before * 100:.1f}%)')
    if args.dry_run:
        print('\nDRY-RUN 이라 파일은 바뀌지 않았습니다.')


if __name__ == '__main__':
    main()
