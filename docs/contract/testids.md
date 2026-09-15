# UI 계약 — data-testid

e2e/비주얼 QA 노드와 플레이어 구현 노드의 공용 계약. 이름을 바꾸면 테스트가 깨진다.

| testid | 위치 | 비고 |
|---|---|---|
| `title-screen` | 타이틀 화면 루트 | |
| `start-button` | 「처음부터 시작」 | 클릭 시 게임 시작 |
| `continue-button` | 「이어서 하기」 | 저장 없으면 disabled |
| `connect-button` | 「Google 연결」 | 미연결일 때만 |
| `hello-button` | 「한 줄 받기」(P2에서 타이틀에서 제거) | P4 스튜디오 진입으로 이사. 구 스펙 삭제됨 |
| `agent-input` | 스튜디오 지시 입력(P4 이사 예정) | P2 타이틀에는 없음 |
| `agent-button` | 「지시하기」(P4 이사 예정) | P2 타이틀에는 없음 |
| `agent-diff` | 도구 diff 배너 | PLAY 위에. 턴이 디스크를 고쳤을 때만 |
| `auth-status` | 연결 상태 문구 | |
| `hello-error` | 한 줄 받기 실패 | 있을 때만 |
| `stage` | 게임 화면 루트 | |
| `bg-image` | 배경 `<img>` | `naturalWidth > 0` 이어야 한다 |
| `sprite-left` `sprite-center` `sprite-right` | 스프라이트 `<img>` | 비어 있으면 렌더하지 않는다 |
| `dialogue-box` | 대사 박스 | |
| `speaker-name` | 화자 이름 | 내레이션이면 렌더하지 않는다 |
| `dialogue-text` | 타이핑되는 본문 | |
| `advance-button` | 화면 전체 클릭 영역 | 클릭 = 다음 줄 |
| `choice-menu` | 선택지 컨테이너 | |
| `choice-0` `choice-1` `choice-2` | 선택지 버튼 | |
| `chapter-label` | 장 제목 | 씬에 `chapter` 있을 때만 |
| `save-button` `load-button` | 저장/불러오기 | |
| `auto-button` `skip-button` `history-button` | 오토/스킵/기록 | |
| `back-button` | 「이전」 | 직전 줄/선택으로 되돌아간다. PageUp 키와 같다 |
| `art-view-button` | 「원화 감상」 토글 | 대사 박스를 숨기고 CG만 본다. H 키와 같다 |
| `history-panel` | 기록 패널 | `backlog-close` 버튼, `backlog-chapter` 장 구분 포함 |
| `settings-button` `settings-panel` | 설정(볼륨/속도) | `bgm-volume` 슬라이더 포함 |
| `slot-row-0` … `slot-row-5` `slot-row-auto` | 저장/불러오기 슬롯 | `slot-save-N`/`slot-load-N` 버튼 포함 |
| `bgm-audio` | BGM `<audio>` | `currentTime` 이 증가해야 한다 |
| `gallery-button` | 타이틀 「갤러리」 | |
| `gallery-panel` | 갤러리 다이얼로그 | `gallery-close` 버튼 포함. CG/결말 해금 목록 |
| `title-saves` | 타이틀 「저장 기록」 | 저장이 있을 때만 |
| `credits-button` `credits-panel` | 크레딧 | 타이틀·엔딩 양쪽에 `credits-button` 이 있다 |
| `ending-screen` | 엔딩 화면 | |
| `ending-title` | 엔딩 제목 | |
| `back-to-title` | 타이틀로 | |
| `fatal` | 치명적 오류 화면 | 원고/저장 오류 시 |
| `fatal-title` `fatal-continue` `fatal-restart` | 오류 복구 버튼 | `fatal-continue` 는 저장이 있을 때만 |
| `studio-return` | 스튜디오 미리보기 복귀 링크 | 스튜디오 미리보기에서만 |

전역: `window.__vn` 에 `{ sceneId, lineIndex, state }` 를 노출한다(테스트 훅).
저장 키는 `vnmaker:save`, 설정 키는 `vnmaker:settings`. 손상된 JSON 이면 조용히 무시하고 타이틀로 부팅한다.

## 플레이어 (2026-09-14 추가)

적대적 리뷰 수정과 함께 늘어난 플레이어 계약. 위 표의 이름은 그대로 유효하다.

| testid | 위치 | 비고 |
|---|---|---|
| `bg-image` | 현재(또는 로드 중인 새) 배경 `<img>` | 씬이 바뀌면 새 배경이 이 이름을 바로 받는다. 로드 실패 시 `data-art-fallback="true"`(기본 배경) → `data-art-error="true"`(어두운 판) |
| `bg-image-previous` | 새 배경이 로드될 때까지 남는 이전 배경 | 로드·페이드가 끝나면 제거된다 |
| `bg-loading` | 「장면을 불러오는 중…」 | 새 배경이 300ms 안에 안 오면 표시 |
| `sprite-left` `sprite-center` `sprite-right` | 배우 원화 | 로드 실패 시 `hidden` + `data-art-error="true"` 인 `<span>` 으로 남는다 |
| `dialogue-live` | 스크린리더용 실시간 영역(`aria-live="polite"`) | 화자와 전체 문장. 보이는 `dialogue-text` 는 `aria-hidden` |
| `title-button` | 게임 중 「타이틀」 | `title-confirm` 확인 창 → `title-confirm-cancel`/`title-confirm-confirm` |
| `mute-button` | 「소리」 토글 | `aria-pressed`. 설정 `mute-toggle` 과 같은 값 |
| `fullscreen-button` | 「전체화면」 | `document.fullscreenEnabled` 가 아니면 렌더하지 않는다 |
| `auto-speed` | 설정 「오토 속도」 슬라이더 | 글자당 ms, 10~150 |
| `mute-toggle` `skip-unread-toggle` | 설정 체크박스 | 음소거 / 읽지 않은 대사도 스킵 |
| `slot-row-quick` `slot-load-quick` | 불러오기 창의 퀵 세이브 행 | F5 저장 · F9 로드. 있을 때만 |
| `media-notice` | 배경음악·효과음 로드 실패 안내 | `aria-live="polite"`, 6초 뒤 사라진다 |

동작 계약:
- 스킵(`skip-button`, Ctrl 길게)은 **현재 씬 안에서 이미 읽은 대사만** 건너뛴다. 씬이 끝나면 선택지·다음 씬 첫 줄에서 멈추고, 엔딩 씬은 마지막 줄에서 멈춘다. 설정 `skipUnread` 로 읽지 않은 대사도 건너뛸 수 있다. 테스트가 스킵을 빨리 감기로 쓰려면 `vnmaker:settings` 에 `{"skipUnread":true}` 를 넣는다.
- 휠 위 = 되돌리기(`back-button`, PageUp 과 같다), 휠 아래 = 다음 대사.
- `window.__vn` 에 `pastLength`(되돌릴 수 있는 수), `reducedMotion` 이 추가됐다.
- 저장 키: `vnmaker:quick[:scope]`(퀵 세이브), `vnmaker:manuscripts[:scope]`(세이브가 지문으로 가리키는 원고 보관함 — 스냅숏은 `scriptKey` 만 가진다), `vnmaker:read[:scope]`(읽은 대사), `vnmaker:settings:<네임스페이스>`(독립 배포판 설정, 없으면 공용 설정을 이어받는다).
- 세이브에는 `rollback`(최근 30개 위치)이 들어 있어 불러온 뒤에도 「이전」이 동작한다.

## 스튜디오 편집 UX (2026-09-14 추가)

| testid / 접근성 이름 | 위치 | 비고 |
|---|---|---|
| `studio-scene-count` | 씬 목록 머리글의 개수 배지 | 270개 이상이면 `N/300` 으로 상한을 함께 보인다 |
| `studio-line-count` | 대사 트랙 머리글의 개수 배지 | 1,800줄 이상이면 `N/2000` |
| `studio-line-capacity` | 대사 textarea 아래 | 남은 글자 2,000자 이하일 때만. textarea 에 `maxlength=20000` |
| `studio-scene-id` | 속성 패널 SCENE 섹션 | 씬 ID 변경. Enter/blur 로 확정, 실패 사유는 같은 label 안 `[role=alert]` |
| `studio-play-anyway` | 검증 팝오버 | 다른 장면에만 오류가 있을 때 「그래도 미리보기」. 현재 장면·바로 이어지는 장면에 오류가 있으면 없다 |
| `scene-paste` `scene-paste-confirm` | 장면 도구 「원고 붙여넣기」 대화상자 | textarea 는 `aria-label="붙여넣을 원고"`. `이름: 대사` 접두를 화자로 해석 |
| `palette-replace-toggle` `palette-replace-one` `palette-replace-all` | 빠른 찾기(Ctrl+K)의 바꾸기 모드 | 바꿀 내용 입력은 `aria-label="바꿀 내용"`. 바꾸기 모드에서 결과 클릭은 이동이 아니라 선택이다 |
| `production-drawer` | 원고·분량 뷰 하단 `<details>` | 열면 `production-panel`(장편 AI 제작실)이 마운트된다. 닫혀 있으면 네트워크 요청이 없다 |
| `graph-canvas` | 스토리 맵 캔버스 | 깊이를 여러 띠로 감아 배치한다 |
| 「선택한 대사 위로 이동」「선택한 대사 아래로 이동」「선택한 대사 복제」 | 대사 트랙 머리글 버튼 | Alt+↑/↓ 와 같다 |
| 「장면 위로 이동」「장면 아래로 이동」 | 씬 목록에서 선택된 항목 옆 | Alt+Shift+↑/↓ 와 같다. 장면 도구의 「장면 목록에서 위로 이동」과 별개 |
| `<id> ID 변경` | 등장인물 카드 | 캐릭터 ID 변경. Enter/blur 로 확정 |
| `<key> 이름 변경` | 작품 상태 변수 행 | 변수 이름 변경. Enter/blur 로 확정 |

편집 거부: 파서 상한을 넘는 편집은 원고에 들어가지 않고 `role=status` 토스트에 「변경을 적용하지 않았습니다. …」로 사유를 보인다.
미디어 누락: 원고가 가리키는 로컬 파일이 404 면 검증 목록에 「파일을 찾을 수 없습니다: …」 경고로 나타나고 푸터 `studio-validation` 이 「검토 N건」이 된다. 네트워크 오류나 준비되지 않은 서비스 워커는 경고하지 않는다.

## 스튜디오 데이터·내보내기 (2026-09-14 추가)

| testid / 역할 | 위치 | 비고 |
|---|---|---|
| `storage-usage` | 아트 디렉션 헤더, 내 작품 보관함 | `navigator.storage.estimate()` 사용량·한도 문구 |
| `art-remove` | 아트 디렉션 「선택한 이미지」 | 작품에 등록된 카드만. 장면·배우가 쓰면 disabled. 어떤 작품·버전도 안 쓰는 `/assets/user/` 파일은 함께 삭제 |
| `art-import-notice` | 내 원화 가져오기 | 같은 용도로 이미 등록된 파일을 건너뛴 개수 |
| `audio-remove-notice` | 내 음원 보관함 | 「보관함에서 제거」 뒤 파일 삭제/보존 안내 |
| `project-row-<id>` | 내 작품 보관함 행 | `열기`·`복제`·`<제목> 삭제` 버튼. 삭제는 두 단계(`<제목> 삭제 확정` / `취소`), 현재 작품은 disabled |
| `project-library-notice` | 내 작품 보관함 | 삭제·복원·배포 ID 정리 안내 |
| `project-restore-file` | 내 작품 보관함 | `.zip`(게임 ZIP) 외에 `.json`(원고 또는 보관함 원본 JSON)도 받는다 |
| `recovery-salvage` `recovery-salvage-summary` | 원고 복구 패널 | 상한 초과로 읽지 못한 원고를 잘라 복구. 상한 초과가 아니면 렌더하지 않는다 |
| 알림 `role=alert` 문구 | 원고 복구 | 읽기 실패 사유(`parseScript` 메시지)와 「보관함의 최신 원고를 열었습니다」(사본이 보관함보다 오래된 경우) |

저장 키: `vnmaker.studio.project.meta.v1` = `{updatedAt, hash}` — 빠른 복구 사본의 나이. 사본 쓰기 실패 + 보관함 저장 성공이면 사본 키를 비운다.
배포 `index.html`: 모듈 스크립트 앞의 고전 `<script>`가 `file://` 에서 「이 폴더를 정적 웹 서버에서 열어주세요」 안내를 렌더한다.

## AI 스토리 점검 · 이미지 엔진 (2026-09-14 추가)
- `story-check` — 원고·분량 뷰의 AI 스토리 점검 섹션 컨테이너.
- `story-check-run` — agy(Gemini)로 서사 점검을 실행하는 버튼.
- `story-check-list` / `story-check-finding` — 점검 결과 목록과 각 지적 항목.
- `story-check-empty` — 지적이 없을 때의 안내.
- `story-check-error` — 로그인 필요·업스트림 오류 등 실패 안내(role=alert).
- `art-backend` — 이미지 생성 엔진 선택(codex/agy). 두 백엔드가 모두 보고될 때만 렌더.
