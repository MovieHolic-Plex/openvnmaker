# 전용 CG · 작업 포즈 최종 화면 QA

검수일: 2026-09-06 (KST). 로컬 Studio `http://127.0.0.1:5184/studio.html`. 실제 Chromium/Playwright에서 1440×1000 및 390×844 뷰포트로 촬영했다. 이미지 생성 원본은 수정하지 않았다.

## 결과

- 전용 CG 6개와 작업 포즈 3개를 두 크기에서 검수했다. 각 원고 앵커를 선택하면 해당 자막·CG·포즈가 표시되고 해제 큐에서는 배경 또는 중립 포즈로 복귀한다.
- 본검수 2 tests passed (1.2분). 원화 감상 2 tests passed (31.1초). 두 실행 모두 `tests/e2e/art-direction.spec.ts`에 정의되어 있다.
- 최종 화면 PNG 48장: 일반 Studio 전체/게임 미리보기 36장과 대사 없는 원화 감상 12장. 수정 전 36장은 `evidence/completion-art/before-framing-fix/`에 보존했다.
- 각 뷰포트의 원고·연출·Canvas 픽셀·화면 좌표는 `evidence/completion-art/1440-observations.json` 및 `390-observations.json`에 기록했다.
- 녹색 제거 후 세 작업 포즈의 Canvas 좌상단 알파는 모두 0, 불투명 영역의 강한 녹색 픽셀은 0이다. 자산 파일은 그대로 RGB이며 화면 렌더링에서만 chromaKey를 적용한다.
- 신규 CG에서 스프라이트 중복 노출 없음, 이미지 로딩 실패 없음, 브라우저 pageerror 없음, 본검수 중 내부 `/api/` 요청 없음. 두 뷰포트에서 수평 페이지 넘침 없음.

## 적대적 검수에서 찾고 고친 문제

1. 전역 배경 `scale(1.16)`이 전용 CG까지 확대했다. 첫 관람객 CG의 가장자리 패널과 카트가 잘려 보였다. `art-stage.css`에서 CG에 한해 확대를 제거하고 원래 화면 비율을 유지했다. 최종 원화 감상 화면에서 유리 5장과 빈 여섯째 틀·청소 카트를 확인했다.
2. 기존 Studio 배우 배치가 아래로 20% 밀려 작업 포즈의 핵심 소품을 대사창 뒤에 숨겼다. 작업 포즈가 있는 장면은 모든 배우를 함께 88% 높이/아래 여백 12%로 배치했다. 서린의 붓과 천, 도현의 드라이버와 케이블, 미래의 서류 폴더가 대사창 위에 보인다. 배우 사이 상대 크기는 유지한다.
3. 모바일 헤더와 장면 도구가 한 줄에 밀려 플레이·집중 모드가 오른쪽에서 잘렸다. `studio-modern.css`에서 헤더를 두 줄로 구성하고 장면 도구를 줄바꿈했다. 숨겨졌던 JSON을 다시 노출했으며 버전 기록의 접근 이름도 유지했다. JSON·ZIP·버전·플레이의 실제 버튼 경계가 390px 안에 들어오는지 검증했다.
4. `ArtImage`가 새 이미지 소스로 바뀔 때 기존 `data-loaded` 표시가 남을 수 있었다. 새 로딩 시작 시 완료 표시를 지우고 실패 상태를 초기화한다. 새 그림이 실제 Canvas에 그려진 뒤 완료 표시가 다시 설정된다.
5. CG 하단의 포장 손·측정 도구가 대사창에 가려지는 정상적인 오버레이 한계를 확인했다. 부모 작업에서 구현한 `원화 감상` 버튼으로 대사를 숨겨 전체 그림을 검수했다. 복귀 후 원래 자막이 동일함을 확인했다.

## 원고와 그림 일치

| 장면 | 파일 | 확인한 구체 요소 |
|---|---|---|
| s03 | empty-sixth-frame-cg.png | 청색 유리 5장, 빈 금속틀 1개, 고정대·풀린 클램프. 비 오는 밤 아트리움 |
| s06a | seorin-packing-cg.png | 바닥의 종이, 서린 한 손과 우진 두 손, 글자 없는 종이 뒷면. 아직 찾지 않은 유리 패널은 넣지 않음 |
| s06b | recorder-ribbon-cg.png | 낡은 검은 휴대 녹음기 케이스, 살구색 끈, 도현 한 손. 재생 중인 화면 없음 |
| s08 | records-comparison-cg.png | 청색/노란 책갈피, 나란한 두 기록, 산호색 소매. 개인 문장이나 날짜는 읽히지 않음 |
| s14 | glass-assembly-cg.png | 유리 5장과 빈 여섯째 틀의 청색 안쪽선, 측정과 나사 조임, 정리된 케이블 |
| s17a | first-visitor-cg.png | 아침 청소 직원의 뒷모습, 출입구 옆 카트, 같은 전시 구조·아침 빛 |

작업 포즈는 기존 중립 원화를 참조 편집했다. 얼굴·머리·의상 팔레트가 유지되고, 추가 팔다리나 눈에 띄는 손가락 이상·초록 테두리는 발견하지 못했다. 텍스트가 포함된 기록 원화는 읽을 수 없는 인쇄 질감이므로 실제 기록 정보는 원고가 전달한다.

## 대표 증거

- `evidence/completion-art/1440-first-visitor-cg-art-only.png`: 5장 유리와 빈 틀·첫 관람객·카트.
- `evidence/completion-art/1440-glass-assembly-cg-art-only.png`: 측정과 나사 조임 손동작, 빈 금속틀.
- `evidence/completion-art/1440-seorin-packing-cg-art-only.png`: 바닥 포장 손 3개.
- `evidence/completion-art/1440-dohyun-working-stage.png`: 드라이버와 케이블이 대사창 위로 드러나는 최종 배치.
- `evidence/completion-art/1440-mirae-reading-stage.png`: 얼굴·서류·청색/노란 책갈피.
- `evidence/completion-art/390-seorin-working-studio.png`: 최종 모바일 헤더·JSON/ZIP/버전/플레이·집중 모드·원화 감상.

검수 범위는 위 9개의 새 그림과 해당 연출 큐다. 90분 분량 전체 원고의 모든 대사를 사람 속도로 완주한 검수로 확대 해석하지 않는다.
