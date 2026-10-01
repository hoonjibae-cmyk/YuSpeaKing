# Student Card 명단 연동

YuSpeaKing은 Student Card에서 현재 재원생의 반과 연락처만 읽습니다. Student Card의 인사·계정 권한과는 별개인 전용 읽기 키를 사용합니다.

## 인증

Student Card의 `YUSPEAKING_ROSTER_KEY`와 YuSpeaKing의 `STUDENT_CARD_ROSTER_KEY`에 같은 32자 이상의 임의 값을 저장합니다. 키는 서버 사이 요청의 `x-yuspeaking-roster-key` 헤더에만 넣습니다.

## 엔드포인트

- `GET https://card.yussam.com/api/integrations/yuspeaking/classes`: 반 ID, 이름, 담당자, 재원생 수. 학생 연락처는 포함하지 않습니다.
- `GET https://card.yussam.com/api/integrations/yuspeaking/classes/{반ID}/students`: 해당 반 재원생의 ID, 이름, 학생 휴대폰, 학부모 휴대폰.

성공 응답에는 `ok: true`, `complete: true`, `version: 1`이 들어갑니다. YuSpeaKing은 이 값과 필드 형식을 확인하며, 불완전한 응답을 빈 명단으로 취급하지 않습니다. 두 엔드포인트는 같은 Student Card 재원생·반 배정 자료를 읽고 쓰기 권한은 없습니다.

YuSpeaKing 관리자가 반을 한 번 연결하면, 매일 새벽 또는 담당자가 수동으로 명단을 확인할 때 해당 반만 동기화합니다. 기존 YuSpeaKing의 내부 `hr_` 테이블·필드명은 데이터 호환성을 위해 그대로 유지합니다.
