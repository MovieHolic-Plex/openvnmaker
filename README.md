# vnmaker

AI 네이티브 비주얼 노벨 저작 스튜디오. 로컬 Hono 게이트웨이가 모델 접근을 감싸고,
Vite + React 플레이어가 시나리오를 재생한다. 함께 들어 있는 작품은 한국 대학 캠퍼스를
배경으로 한 수채화 중편 「여름의 잔상」이다.

## 구성

```
packages/app        Vite + React VN 플레이어 (엔진은 React 밖의 순수 리듀서)
packages/gateway    Hono 게이트웨이 — Antigravity OAuth, 모델 카탈로그 + 할당량 프록시
packages/content    시나리오 스키마 · 에셋 매니페스트 · script.json · 콘텐츠 체커
tools/imagegen      grok CLI 병렬 이미지 생성기 + 순수 JS PNG 알파 키어
tools/audio         무의존 DSP 로 OST·효과음 합성, lamejs 로 MP3 인코딩
tests/e2e           Playwright 플레이스루 · 엣지 · 비주얼 QA
docs/contract       시나리오·UI 계약 (스토리 바이블, data-testid 표)
```

## 실행

```bash
pnpm install
pnpm dev              # 플레이어  http://127.0.0.1:5173
pnpm dev:gateway      # 게이트웨이 http://127.0.0.1:51120
```

게이트웨이는 **127.0.0.1 전용**이다. OAuth 토큰을 프록시하므로 `0.0.0.0` 에 바인딩하거나
터널로 열지 않는다. 원격 작업은 SSH 포트포워딩으로 한다.

```bash
ssh -L 51120:127.0.0.1:51120 -L 5173:127.0.0.1:5173 <host>
```

## 인증

```bash
curl -X POST http://127.0.0.1:51120/api/auth/login   # 브라우저 동의
curl http://127.0.0.1:51120/api/auth/status
curl http://127.0.0.1:51120/api/models               # 만료 시 자동 갱신
```

자격증명은 `~/.vnmaker/auth.json` 의 `google-antigravity` 키에 저장된다.
**비공식 어댑터다.** 구글 공식 연동이 아니고, tier 는 항상 `free-tier` 로 응답한다.
할당량 카운터는 계정+프로젝트 단위 서버 값이라서 Antigravity 데스크톱 앱과 같은 통을 쓴다.

Windows 에서는 `chmod 0600` 이 무시되므로 `%USERPROFILE%\.vnmaker` 폴더 ACL 을 직접 좁혀야 한다.

## 이미지 생성

삽화도 같은 agy 경로로 뽑는다. 게이트웨이가 봉투(`responseModalities:["IMAGE"]`, `project` 필수)를
감추고 결과를 `~/.vnmaker/images` 에 파일로 떨어뜨린다. 응답에 base64 를 싣지 않는다.

```bash
curl http://127.0.0.1:51120/api/image/config          # 기본 모델 · 허용 비율
curl -X POST http://127.0.0.1:51120/api/image/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"수채화 캠퍼스 배경, 인물 없음","aspectRatio":"16:9","name":"bg-campus"}'
curl -o bg.jpg http://127.0.0.1:51120/api/image/file/bg-campus.jpg

pnpm qa:image                                         # 실계정 1회 호출 실측 (증거 evidence/image/)
```

기본 모델은 `gemini-3.1-flash-image` 다. 이 계정 카탈로그에 실제로 있는 id 를 골랐고,
바뀌면 `VNMAKER_IMAGE_MODEL` 로 덮어쓴다. **이 카운터는 코딩 할당량과 같은 통이다** —
삽화를 뽑으면 텍스트 몫이 같이 줄고 Antigravity 데스크톱 앱과도 공유된다. CI 에 물리지 마라.

## 검증

```bash
pnpm typecheck        # 전 패키지 tsc
pnpm test             # content 체커 + 게이트웨이 + 엔진 단위 테스트
pnpm build            # gateway tsc + app vite build
pnpm e2e              # Playwright (dev 서버 자동 기동)
```

## 에셋 재생성

```bash
node tools/imagegen/run.mjs --concurrency 5      # grok CLI 로 배경·스프라이트
node tools/imagegen/run.mjs --only bg-title --force
node tools/audio-gen.mjs                        # OST 5곡 + 효과음 10종
node tools/audio-check.mjs                      # MP3 프레임을 파싱해 길이 검증
```

이 머신의 유일한 ffmpeg(playwright 번들)에는 PNG 디코더도 오디오 인코더도 없다.
그래서 알파 키잉과 MP3 인코딩을 각각 `tools/imagegen/png-alpha.mjs` 와 `lamejs` 로 처리한다.

## 콘텐츠 정책

등장 인물은 전원 성인 대학생이다. 아동·미성년·교복은 텍스트와 이미지 어디에도 등장하지 않는다.
`packages/content/test/script.test.ts` 가 금지 토큰을 기계적으로 막는다.
