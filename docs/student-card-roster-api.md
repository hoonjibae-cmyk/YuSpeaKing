# Student Card 명단 연동

YuSpeaKing은 Student Card에서 현재 재원생의 반과 연락처만 읽습니다. Student Card의 인사·계정 권한과는 별개인 전용 읽기 키를 사용합니다.

## 인증

Student Card의 `YUSPEAKING_ROSTER_KEY`와 YuSpeaKing의 `STUDENT_CARD_ROSTER_KEY`에 같은 32자 이상의 임의 값을 저장합니다. 키는 서버 사이 요청의 `x-yuspeaking-roster-key` 헤더에만 넣습니다.

## 엔드포인트

- `GET https://card.yussam.com/api/integrations/yuspeaking/classes`: 반 ID, 이름, 담당자, 재원생 수. 학생 연락처는 포함하지 않습니다.
- `GET https://card.yussam.com/api/integrations/yuspeaking/classes/{반ID}/students`: 해당 반 재원생의 ID, 이름, 학생 휴대폰, 학부모 휴대폰.

성공 응답에는 `ok: true`, `complete: true`, `version: 1`이 들어갑니다. YuSpeaKing은 이 값과 필드 형식을 확인하며, 불완전한 응답을 빈 명단으로 취급하지 않습니다. 두 엔드포인트는 같은 Student Card 재원생·반 배정 자료를 읽고 쓰기 권한은 없습니다.

YuSpeaKing 관리자가 반을 한 번 연결하면, 매일 새벽 또는 담당자가 수동으로 명단을 확인할 때 해당 반만 동기화합니다. 기존 YuSpeaKing의 내부 `hr_` 테이블·필드명은 데이터 호환성을 위해 그대로 유지합니다.

## 학년 필터 (초6)

유스피킹은 초6 만 운영하므로 두 엔드포인트에 `?schoolLevel=초등&grade=6` 을 붙여 부릅니다.

- Student Card 의 `school_level`(초등·중등·고등)과 `grade`(숫자)로 재원생을 거릅니다.
- 반 목록은 그 학년 학생이 한 명이라도 있는 반만, `studentCount` 도 그 학년 학생 수만 셉니다.
- 응답에 적용한 필터를 `filter: { schoolLevel, grade }` 로 되돌려 줍니다. 유스피킹은 이 값이
  없으면 '걸러지지 않은 명단' 으로 보고 반·학생을 새로 만들거나 옮기거나 비활성화하지 않습니다.
- 필터를 주지 않으면 예전과 같이 전체를 줍니다 (다른 연동에 영향 없음).
- 형식이 틀린 필터는 400 입니다.

Student Card 쪽 변경은 `docs/student-card-grade-filter.patch` 에 있습니다 (Student Card 저장소에서
`git am` 으로 적용).

## 유스피킹이 하는 일

운영자 → **Student Card 연동** 화면에서 관리합니다.

1. **전환** (처음 상태): 선생님(이름)·반(이름, 같으면 담임)·학생(이름 → 전화번호)을 자동으로
   맞추고, 맞추지 못한 것은 화면에 남깁니다. 기존 자료는 바꾸지 않습니다 — 비어 있는 연락처만
   채우고, 다른 번호는 '차이' 로 보여 줍니다.
2. **일원화** (운영자가 켬): 매일 새벽 동기화가 Student Card 를 따라 반·학생을 만들고, 반이 바뀐
   학생을 옮기고, 담임을 바꾸고, 사라진 학생을 비활성으로 돌립니다. 바뀐 것은 모두 기록에 남깁니다.
   선생님의 반 만들기·학생 추가·가입 승인과 공용 가입 링크는 막히고, 학생은 가입 안내 알림톡의
   개인 링크로 계정을 만듭니다.
