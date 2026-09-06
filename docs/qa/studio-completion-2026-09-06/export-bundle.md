# 독립 게임 ZIP 검증

2026-09-06, Chromium / Windows. 앱 내부 AI 호출 없이 구현·검증했다.

## 구현

- 헤더의 **게임 ZIP**은 버튼을 누른 순간의 편집 원고를 복제한다. 이후 원본 프로젝트를 변경하지 않는다.
- `project.json`, 독립 플레이어 JS/CSS, 등록 아트 및 장면·줄 단위 배경/CG/포즈/표정/음악/효과음, `bundle.json`, 실행 안내를 묶는다.
- `/api/image/file/` 그림은 실제 바이트를 받아 `assets/exported/`로 옮기고 모든 해당 참조를 재작성한다.
- 에셋 404와 HTML fallback을 포함한 파일 형식 오류를 모아 보여준다. 오류·취소 때 부분 ZIP은 다운로드하지 않는다.
- 런타임 템플릿은 별도 Vite 빌드에서 만들어 기본 `rain-blank.json`을 포함하지 않는다. 개발 서버와 정식 빌드 모두 제공한다. 플레이어 파일의 크기와 SHA-256도 확인한다.
- 원고 콘텐츠 해시를 저장 namespace로 전달한다. 다른 작품/다른 원고 버전/에디터 미리보기의 저장을 읽지 않는다.
- 추가 패키지 없이 표준 STORE ZIP을 작성한다. 이미 압축된 PNG/WebP/MP3를 다시 압축하지 않으며 4GB 미만을 지원한다.

## 결과

- `test/export-bundle.test.ts`: 6/6 통과 — 전체 연출 수집, 게이트웨이 참조 재작성, 원고 스냅샷, ZIP CRC, 저장 namespace, 누락·취소·변조 검사.
- `tests/e2e/export-bundle.spec.ts`: 개발 서버 5193에서 4/4 통과.
- 최종 `pnpm build` 통과(앱 Vite 빌드 + gateway TypeScript 빌드). 최종 CSS, 원화 감상, 저장 슬롯, 편집기 복원 수정이 반영된 빌드 미리보기 5194에서 장편 전체 ZIP E2E 1/1 통과(59.2초).
- 실제 브라우저 다운로드 후 Windows `Expand-Archive`로 압축을 풀고, 임의의 새 포트의 정적 HTTP 서버에서 실행했다. fixture의 줄별 배경/포즈/CG/음악, 자동저장 후 새로고침, 조건부 대사와 엔딩, 타이틀 복귀를 확인했다. 외부/API 요청·누락 파일·브라우저 예외 0건.
- 장편 전체도 17개 장면 경로를 완주해 `빈칸을 전시하다` 엔딩에 도달했다. 이 검증 스냅샷은 20개 장면, 829줄, 등록 아트 35개, ZIP 전체 파일 54개다.
- 실제 장편의 수동 슬롯 두 개를 서로 다른 대사 위치에 저장한 뒤 각각 불러와 정확한 위치·원고를 복원했다. 원화 감상 화면에서 대사와 툴바가 숨겨지고, 정상 자동 진행 대기시간보다 오래 기다려도 진행 위치가 바뀌지 않으며, 대사를 다시 표시하고 계속 플레이할 수 있음을 확인했다.
- 최종 프로덕션 ZIP은 81,167,840 bytes이며 `bundle-be8e2833e857bd36` namespace를 사용한다. 런타임은 `player-CKWG1alZ.js`이고 최신 `원화 감상` 코드가 포함된 것을 파일에서도 확인했다. 이후 원고 편집은 새 ZIP을 만들어 반영해야 한다.
- 배포 대화상자, 완료 화면, 독립 플레이어 CG, 실제 장편 타이틀/엔딩/저장 슬롯/원화 감상 스크린샷을 육안 검토했다.
- 최종 ZIP의 manifest가 나열한 모든 파일의 실제 바이트 크기를 확인했고, `output/rain-blank.vn.json`과 현재 `packages/content/data/rain-blank.json`을 JSON 객체 단위로 대조해 완전히 같음을 검증했다.

## 최종 결과물

| 파일 | 실제 bytes | SHA-256 |
|---|---:|---|
| `output/rain-blank-game.zip` | 81,167,840 | `ace19570691a41bd01f4d132827305c41b786f91ee30c52e85c89ade1b3adee7` |
| `output/rain-blank.vn.json` | 227,482 | `be8e2833e857bd368cc2929d536500588519af27adb14276ec1cbc76f35887ff` |

`output` 폴더의 다른 파일은 변경하지 않았다.

## 증거

- 개발 E2E: `evidence/export-bundle-2026-09-06/`
- 초기 정식 빌드 E2E: `evidence/export-production-2026-09-06/`
- 최종 정식 빌드 E2E: `evidence/export-final-2026-09-06/export-bundle-the-entire-l-092db-ys-through-a-complete-route-desktop/`
- 최종 스크린샷: 위 폴더의 `longform-standalone-title.png`, `longform-standalone-slots.png`, `longform-standalone-art-view.png`, `longform-standalone-ending.png`.
- 최종 배포 파일은 고정 경로 `output/rain-blank-game.zip`에 복사했다. 원본 다운로드 및 실제 플레이한 압축 해제 폴더도 최종 E2E 증거 폴더에 보관했다.

## 실행 범위

ZIP을 모두 풀어 정적 호스팅 **사이트 루트**에 올리거나, 해당 폴더에서 `python -m http.server 8080`을 실행한다. `file://` 더블클릭과 호스팅의 하위 경로 배포는 지원하지 않는다. 이 범위는 UI와 ZIP의 README에도 표시한다. 별도 게이트웨이, 앱 로그인, 외부 폰트, AI API가 필요하지 않다.
