# UI 계약 — data-testid

e2e/비주얼 QA 노드와 플레이어 구현 노드의 공용 계약. 이름을 바꾸면 테스트가 깨진다.

| testid | 위치 | 비고 |
|---|---|---|
| `title-screen` | 타이틀 화면 루트 | |
| `start-button` | 「처음부터 시작」 | 클릭 시 게임 시작 |
| `continue-button` | 「이어서 하기」 | 저장 없으면 disabled |
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
| `history-panel` | 기록 패널 | |
| `settings-button` `settings-panel` | 설정(볼륨/속도) | |
| `bgm-audio` | BGM `<audio>` | `currentTime` 이 증가해야 한다 |
| `ending-screen` | 엔딩 화면 | |
| `ending-title` | 엔딩 제목 | |
| `back-to-title` | 타이틀로 | |

전역: `window.__vn` 에 `{ sceneId, lineIndex, state }` 를 노출한다(테스트 훅).
저장 키는 `vnmaker:save`, 설정 키는 `vnmaker:settings`. 손상된 JSON 이면 조용히 무시하고 타이틀로 부팅한다.
