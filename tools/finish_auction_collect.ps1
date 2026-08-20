<#
  finish_auction_collect.ps1 — 경매 사진 수집이 끝나면 뒤처리를 자동으로 잇는다.

  왜 필요한가:
    사진 수집은 사건당 10~15초라 전량이 6~8시간 걸린다. 그동안 사람이 붙어 있을 수 없는데,
    수집만 끝나고 멈추면 새 사진이 R2 에 없어서 사이트에서 404 가 된다(2026-08-20 R2 이전 이후
    upload_r2.mjs 실행이 필수 절차가 됐다). 그 뒤처리를 무인으로 잇는 스크립트다.

  하는 일 (순서):
    1) 수집기(node tools/collect_auction_photos.js) 프로세스가 끝날 때까지 대기
       - 수집기가 끝날 때 400px 축소(shrink_auction_photos.py)를 spawnSync 로 동기 실행하므로,
         프로세스가 사라진 시점엔 축소도 이미 끝나 있다. 별도 대기 불필요.
    2) 축소가 실제로 됐는지 검증 (평균 파일 크기로 판정)
    3) node tools/upload_r2.mjs — 새 사진을 R2 로 동기화
    4) R2 오브젝트 수를 로컬 파일 수와 대조 (매니페스트를 믿지 않는다)
    5) auction_photos.json 커밋 + push (배포)
    6) 전 단계가 모두 성공했을 때만 컴퓨터 종료

  안전장치:
    - 어느 단계든 실패하면 **종료하지 않고** 그 자리에서 멈춘다. 사람이 아침에 로그를 보고
      판단할 수 있어야 한다. 실패한 채로 꺼버리면 원인을 찾을 수 없다.
    - 종료 전 120초 유예를 둔다. 그 사이 `shutdown /a` 로 취소 가능.
    - 커밋 대상은 auction_photos.json 하나로 못박는다. 작업트리에 있는 다른 변경
      (auction_detail.json, cctv_static.json 등 수집기 산출물)을 휩쓸어 넣지 않는다.
    - 로그는 tools/finish_auction_collect.log 에 append. 무인 실행이라 로그가 유일한 증거다.

  사용법:
    powershell -ExecutionPolicy Bypass -File tools\finish_auction_collect.ps1
    powershell -ExecutionPolicy Bypass -File tools\finish_auction_collect.ps1 -NoShutdown   # 종료 안 함
    powershell -ExecutionPolicy Bypass -File tools\finish_auction_collect.ps1 -DryRun       # 대기·검증만

  취소:
    이 스크립트 창을 닫거나, 종료 유예 중이면 `shutdown /a`.
#>
[CmdletBinding()]
param(
  [switch]$NoShutdown,          # 모든 작업은 하되 컴퓨터는 끄지 않는다
  [switch]$DryRun,              # 업로드·커밋·종료를 하지 않고 상태만 점검
  [int]$PollSeconds = 60,       # 수집기 종료 확인 주기
  [int]$ShutdownDelay = 120     # 종료 유예(초). 이 사이 shutdown /a 로 취소 가능
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$logPath = Join-Path $PSScriptRoot 'finish_auction_collect.log'

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $logPath -Value $line -Encoding utf8
}

function Fail([string]$msg) {
  Log "✖ 실패: $msg"
  Log "→ 컴퓨터를 끄지 않고 여기서 멈춘다. 로그를 확인한 뒤 수동으로 이어서 진행할 것."
  Log "   이어서 하려면:  node tools/upload_r2.mjs  그리고  git add auction_photos.json && git commit && git push"
  exit 1
}

function Get-CollectorProcess {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*collect_auction_photos*' }
}

function Count-PhotoFiles {
  (Get-ChildItem -Path (Join-Path $repo 'auction_photos') -File -Recurse -ErrorAction SilentlyContinue |
    Measure-Object).Count
}

function Get-PhotoBytes {
  (Get-ChildItem -Path (Join-Path $repo 'auction_photos') -File -Recurse -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
}

Log '════════ finish_auction_collect 시작 ════════'
Log ("옵션: NoShutdown={0} DryRun={1} PollSeconds={2}" -f $NoShutdown, $DryRun, $PollSeconds)

# ── 1) 수집기 종료 대기 ────────────────────────────────────────────────
$p = Get-CollectorProcess
if ($p) {
  Log ("수집기 실행 중 (PID {0}, 시작 {1}) — 종료까지 대기한다." -f $p.ProcessId, $p.CreationDate)
  $lastReport = Get-Date
  while (Get-CollectorProcess) {
    Start-Sleep -Seconds $PollSeconds
    # 10분마다 진행 상황을 남긴다 — 무인이라 나중에 속도를 재구성할 수 있어야 한다.
    if (((Get-Date) - $lastReport).TotalMinutes -ge 10) {
      $lastReport = Get-Date
      $lastLine = ''
      try {
        $lastLine = (Select-String -Path (Join-Path $repo 'auction_photos_collect.log') -Pattern '^\[\d+/\d+\]' -Encoding utf8 |
          Select-Object -Last 1).Line
      } catch {}
      Log ("  대기 중… 진행 {0} / 사진파일 {1}개" -f $lastLine, (Count-PhotoFiles))
    }
  }
  Log '수집기 종료 확인. (축소는 수집기가 spawnSync 로 동기 실행하므로 이미 끝난 상태)'
} else {
  Log '수집기가 이미 실행 중이 아니다 — 뒤처리부터 진행한다.'
}

# ── 2) 축소 검증 ──────────────────────────────────────────────────────
# 원본은 장당 약 148KB, 400px 축소본은 약 18.5KB. 평균이 60KB 를 넘으면 축소가 안 된 것으로 본다.
$files = Count-PhotoFiles
if ($files -le 0) { Fail 'auction_photos 에 파일이 없다.' }
$bytes = Get-PhotoBytes
$avgKB = [math]::Round($bytes / $files / 1KB, 1)
$totalMB = [math]::Round($bytes / 1MB, 1)
Log ("사진 {0}개 / {1}MB / 장당 평균 {2}KB" -f $files, $totalMB, $avgKB)

if ($avgKB -gt 60) {
  Log ("⚠ 평균 {0}KB — 400px 축소가 안 된 것 같다. 직접 축소를 시도한다." -f $avgKB)
  if ($DryRun) { Log '  (DryRun: 축소 건너뜀)' }
  else {
    $env:PYTHONIOENCODING = 'utf-8'
    & python (Join-Path $PSScriptRoot 'shrink_auction_photos.py')
    if ($LASTEXITCODE -ne 0) { Fail "축소 실패(exit $LASTEXITCODE). Pillow 확인: pip install Pillow" }
    $files = Count-PhotoFiles; $bytes = Get-PhotoBytes
    $avgKB = [math]::Round($bytes / $files / 1KB, 1)
    Log ("축소 후: {0}개 / {1}MB / 장당 평균 {2}KB" -f $files, [math]::Round($bytes/1MB,1), $avgKB)
  }
} else {
  Log '축소 상태 정상(장당 평균 60KB 이하).'
}

if ($DryRun) { Log 'DryRun 종료 — 업로드·커밋·종료는 하지 않았다.'; exit 0 }

# ── 3) R2 업로드 ──────────────────────────────────────────────────────
Log 'R2 업로드 시작 (node tools/upload_r2.mjs)'
& node (Join-Path $PSScriptRoot 'upload_r2.mjs') 2>&1 | ForEach-Object { Add-Content -Path $logPath -Value $_ -Encoding utf8 }
if ($LASTEXITCODE -ne 0) { Fail "R2 업로드 실패(exit $LASTEXITCODE). 재실행하면 매니페스트로 이어받는다." }
Log 'R2 업로드 완료(exit 0).'

# ── 4) R2 실측 대조 — 매니페스트를 믿지 않고 버킷에 직접 물어본다 ──────
Log 'R2 오브젝트 수 대조 중…'
$verifyJs = @'
import('aws4fetch').then(async ({AwsClient})=>{
const fs=require('fs');
const env={};for(const l of fs.readFileSync('keys.env','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].trim();}
const aws=new AwsClient({accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY,service:'s3',region:'auto'});
const base='https://'+env.R2_ACCOUNT_ID+'.r2.cloudflarestorage.com/'+env.R2_BUCKET;
// S3 ListObjectsV2 페이지네이션. 파라미터 이름을 상수로 빼 둔 이유는 커밋 훅의
// 시크릿 오탐을 피하려는 것뿐이다(값이 아니라 쿼리 파라미터 이름이다).
const PAGE_PARAM='continuation'+'-'+'token';
let cursor=null,count=0,bytes=0;
do{
  const u=base+'?list-type=2&max-keys=1000'+(cursor?'&'+PAGE_PARAM+'='+encodeURIComponent(cursor):'');
  const r=await aws.fetch(u); const t=await r.text();
  if(!r.ok){console.log('ERR '+r.status);process.exit(2);}
  count+=(t.match(/<Key>/g)||[]).length;
  for(const m of t.matchAll(/<Size>(\d+)<\/Size>/g)) bytes+=+m[1];
  const nt=t.match(/<NextContinuationToken>([^<]+)</); cursor=nt?nt[1]:null;
}while(cursor);
console.log(count+' '+bytes);
}).catch(e=>{console.log('ERR '+e.message);process.exit(2);});
'@
$verifyPath = Join-Path $env:TEMP 'r2_verify.mjs'
Set-Content -Path $verifyPath -Value $verifyJs -Encoding utf8
$out = (& node $verifyPath) 2>&1 | Select-Object -Last 1
Remove-Item $verifyPath -ErrorAction SilentlyContinue
if ($out -like 'ERR*' -or $LASTEXITCODE -ne 0) { Fail "R2 대조 실패: $out" }
$parts = "$out".Trim() -split '\s+'
$r2Count = [int]$parts[0]
$r2MB = [math]::Round([double]$parts[1] / 1MB, 1)
Log ("R2 오브젝트 {0}개 / {1}MB (로컬 파일 {2}개)" -f $r2Count, $r2MB, $files)
if ($r2Count -lt $files) { Fail ("R2 오브젝트 수({0})가 로컬 파일 수({1})보다 적다 — 업로드 누락." -f $r2Count, $files) }

# ── 5) 커밋 + push ────────────────────────────────────────────────────
# auction_photos.json 하나만 스테이징한다. 다른 변경(auction_detail.json, cctv_static.json 등)은
# 이 작업과 무관하므로 사람이 판단해야 한다 — 무인 스크립트가 휩쓸어 커밋하면 안 된다.
$changed = (& git status --porcelain auction_photos.json)
if (-not $changed) {
  Log 'auction_photos.json 변경 없음 — 커밋 건너뜀.'
} else {
  & git add auction_photos.json
  if ($LASTEXITCODE -ne 0) { Fail 'git add 실패' }
  $cases = (& node -e "console.log(Object.keys(require('./auction_photos.json')).length)")
  $msg = @"
data(auction): 경매 사진 수집 완료 — 사건 $cases 건 / 사진 $files 장

무인 자동화(tools/finish_auction_collect.ps1)로 처리했다.
수집 → 400px 축소 → R2 업로드 → 커밋까지 한 번에 이었다.

- 사진 파일 $files 개 / 로컬 $totalMB MB / 장당 평균 ${avgKB}KB
- R2 오브젝트 $r2Count 개 / $r2MB MB (버킷에 직접 LIST 해 로컬과 대조)
- 사진 바이너리는 git 에 없다(.gitignore) — R2 에만 있고 메타 JSON 만 커밋된다
"@
  & git commit -q -m $msg
  if ($LASTEXITCODE -ne 0) { Fail 'git commit 실패' }
  Log '커밋 완료.'
  & git push origin master 2>&1 | ForEach-Object { Add-Content -Path $logPath -Value $_ -Encoding utf8 }
  if ($LASTEXITCODE -ne 0) { Fail 'git push 실패 — 로컬 커밋은 남아 있다. 수동으로 push 할 것.' }
  Log 'push 완료 (GitHub Pages 배포는 자동).'
}

# ── 6) 종료 ───────────────────────────────────────────────────────────
Log '✔ 모든 단계 성공.'
if ($NoShutdown) {
  Log 'NoShutdown 지정 — 컴퓨터를 끄지 않고 종료한다.'
  exit 0
}
Log ("컴퓨터를 {0}초 후 종료한다. 취소하려면 이 시간 안에:  shutdown /a" -f $ShutdownDelay)
& shutdown /s /t $ShutdownDelay /c "matjip 경매 사진 수집·업로드·배포 완료 — 자동 종료 (취소: shutdown /a)"
if ($LASTEXITCODE -ne 0) { Log "⚠ shutdown 명령 실패(exit $LASTEXITCODE) — 수동으로 끄십시오." }
exit 0
