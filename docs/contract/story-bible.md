# vnmaker 시나리오 계약 (story bible)

시나리오 작성 노드는 이 문서의 씬 id, 배경, BGM, 등장 인물 배치를 **그대로** 지킨다.
이미지 생성 노드와 오디오 생성 노드는 이 문서와 `packages/content/src/manifest.ts` 만 보고 에셋을 만든다.

## 작품

- 제목: 여름의 잔상
- 부제: A Watercolour Summer on Campus
- 배경: 한국의 종합대학 캠퍼스, 6월 말에서 8월. 장마와 늦더위.
- 아트 디렉션: **수채화(watercolour)**. 번짐, 종이 결, 물맺힘, 여백. 사진 같은 렌더링 금지.
- 주인공: 정우진(24). 컴퓨터공학과 4학년. 졸업 프로젝트로 인터랙티브 스토리 엔진을 만드는 중.
  화면에 스프라이트가 없다(1인칭). 대사 speaker 는 `"me"`.

## 등장 인물 (전원 성인 대학생)

| id | 이름 | 나이/학년 | 성격 | 복장 |
|---|---|---|---|---|
| seorin | 한서린 | 23, 회화과 4학년 | 말이 적고 관찰이 예리하다. 졸업 전시를 준비한다. | 물감 묻은 리넨 셔츠, 청바지, 걷어올린 소매 |
| dohyun | 배도현 | 24, 산업디자인과 4학년 | 능글맞고 사람을 잘 챙긴다. 밴드 동아리. | 헐렁한 티셔츠, 데님 재킷, 기타 케이스 |
| mirae | 오미래 | 21, 컴퓨터공학과 3학년 | 밝고 직설적이다. 학생회 총무. | 후드 집업, 크로스백, 스니커즈 |

**금지 사항(콘텐츠 정책, 예외 없음)**: 미성년자·아동·어린이는 텍스트와 이미지 어디에도 등장하지 않는다.
교복(school uniform)은 등장하지 않는다. 고등학생·중학생 시절 회상도 쓰지 않는다.
등장 인물은 모두 성인 대학생이며 사복을 입는다.

## 씬 그래프 (id·배경·BGM 고정)

| scene id | background | bgm | 스프라이트 | 다음 |
|---|---|---|---|---|
| s01-gate | campus-gate | daily | 없음 → mirae(right) | s02-studio |
| s02-studio | art-studio | daily | seorin(center) | s03-cafe |
| s03-cafe | campus-cafe | daily | mirae(left), dohyun(right) | s04-lawn |
| s04-lawn | lawn-sunset | warm | seorin(center) | **선택지 2개** |
| s05-library | library-window | rain | seorin(center) | s06-rooftop |
| s05-corridor | corridor-rain | rain | mirae(left), seorin(right) | s06-rooftop |
| s06-rooftop | rooftop-night | warm | dohyun(left), seorin(right) | s07-studio-night |
| s07-studio-night | art-studio | warm | seorin(center) | **선택지 3개** |
| s08-riverside | riverside-dusk | ending | seorin(center) | 엔딩 「여름의 잔상」 |
| s08-cafe-again | campus-cafe | ending | mirae(center) | 엔딩 「각자의 계절」 |
| s08-corridor-parting | corridor-rain | ending | seorin(center) | 엔딩 「미완의 스케치」 |

선택지 배선:
- s04-lawn → A `s05-library`(affection 1) / B `s05-corridor`(affection 0)
- s07-studio-night → A `s08-riverside`(affection 2) / B `s08-cafe-again`(affection 0) / C `s08-corridor-parting`(affection 1)

## 분량

대사와 내레이션의 **한국어 글자 수 합계 9,500 ~ 12,000자**. 씬당 대략 900자.
한 줄은 40~120자. 40줄을 넘기지 않는다. 내레이션과 대사를 섞는다.
`sfx` 는 manifest 의 id 만 사용한다. 문 열림·발소리·빗소리·매미·붓질·진동·심장박동을 장면에 맞게 배치한다.

## 오디오 포맷

playwright 번들 ffmpeg 에는 오디오 인코더가 없다(png/libvpx 뿐). 시스템 ffmpeg 도 없다.
그래서 오디오는 순수 JS 인코더 `lamejs@1.2.1` 로 **MP3** 로 만든다.
경로는 `/assets/audio/bgm/<id>.mp3`, `/assets/audio/sfx/<id>.mp3` 다.
