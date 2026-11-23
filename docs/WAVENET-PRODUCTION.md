# WaveNet 샘플음성 운영 안내

2026-11-23, v1.53.0. 기준 커밋은 `8aa22039bc7e851aaced03fa9c9441340ac6a959`이다.
운영 검증을 마친 변경을 GitHub 기본 브랜치와 운영용 main에 함께 반영한다.
OpenAI 기본값 coral과 기존 생성 기능은 계속 유지한다.

## 과제 생성과 저장

과제 생성의 샘플음성 목소리에서 미국 영어 WaveNet A~J 중 하나를 선택한다.
F는 비교 테스트에서 선택한 목소리다. 같은 목소리로 일반(1.0)과 자연스러운
느린 낭독(0.7)을 합성한다. 두 요청은 전체 원문을 사용하며 SSML이나 단어별 쉼을
넣지 않는다. UTF-8 5,000바이트 초과, 빈 지문, 미지원 목소리는 자르지 않고 거부한다.

기존 sample_voice 컬럼에 전체 음성 ID를 저장하므로 DB 마이그레이션은 없다.
두 합성이 성공하면 sample-audio 버킷의 새 버전 경로로 각각 업로드한다(upsert=false).
두 업로드가 끝난 뒤 목소리와 두 URL을 한 DB UPDATE로 반영한다.
지문 수정 시에는 새 지문과 해당 음성 URL을 함께 반영한다. 실패하면 기존 참조와
목소리·지문을 보존하며, 다른 공급자로 몰래 바꾸거나 자동 재시도하지 않는다.
신규 과제의 합성 실패 시 과제는 남고 오류를 표시한다.
업로드 후 DB 실패 시 연결되지 않은 객체가 남을 수 있다. 기존 MP3는 자동 삭제하지 않는다.

Azure 발음평가, Whisper 대체 경로, 학생 녹음은 변경하지 않았다.

## 운영 인증과 환경

Google 프로젝트는 `yuspeaking-tts-test`만 사용한다. 이름에 test가 있지만 사용자 승인으로
유스피킹 운영 합성에 연결했다. 하루보카 `yussam-voca`를 사용하거나 변경하지 않는다.
서비스 계정 키 파일은 만들지 않았으며 GOOGLE_APPLICATION_CREDENTIALS가 있으면 거부한다.

Vercel production 환경변수:

```text
WAVENET_ENABLED=true
GOOGLE_CLOUD_PROJECT=yuspeaking-tts-test
GOOGLE_WORKLOAD_IDENTITY_AUDIENCE=//iam.googleapis.com/projects/419110315377/locations/global/workloadIdentityPools/yuspeaking-vercel/providers/production
GOOGLE_TTS_SERVICE_ACCOUNT=yuspeaking-tts@yuspeaking-tts-test.iam.gserviceaccount.com
```

Vercel OIDC → Google Workload Identity Federation → 서비스 계정 단기 토큰을 사용한다.
issuer는 https://oidc.vercel.com/yussam-s-projects 이고 허용 audience는
https://vercel.com/yussam-s-projects 이다. provider 조건은 다음과 같다.

```text
assertion.sub == 'owner:yussam-s-projects:project:yuspeaking:environment:production'
&& assertion.project_id == 'prj_UGbnNUpxLPaSFCV9pmwU12xwjFAJ'
&& assertion.owner_id == 'team_yQgksgstFtAzIMvXDo9oFtkn'
```

서비스 계정에 프로젝트의 roles/serviceusage.serviceUsageConsumer를 부여했다.
해당 production subject만 서비스 계정의 roles/iam.workloadIdentityUser를 갖는다.
다른 앱·preview 신원은 제외한다. TTS, IAM, IAM Credentials, STS API가 필요하다.
Vercel의 production OIDC 발급 설정과 위 환경변수를 다음 배포에서도 유지한다.
비밀값·사용자 ADC·키 파일을 저장소나 배포 소스에 넣지 않는다.

로컬 모의 테스트에는 인증이 필요 없다. 승인된 실제 로컬 테스트만 별도 ADC 설정과
아래 조건을 사용한다. production 자격증명을 테스트로 복사하지 않는다.

```text
NODE_ENV=development 또는 test
WAVENET_TEST_ENABLED=true
GOOGLE_CLOUD_PROJECT=yuspeaking-tts-test
YUSPEAKING_TEST_DATA_ONLY=true
CLOUDSDK_CONFIG=격리된 사용자 ADC 폴더
VERCEL 환경변수 없음
```

## 검증

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
node --test scripts/tts-preview/voice-selection.test.cjs
git diff --check
```

18개 모의 테스트는 선택·허용 환경·입력 제한·생성·재생성·지문 수정·합성/업로드/DB 실패 시
기존 쌍 보존·OpenAI 경로·OIDC 구성을 확인한다. 유료 API나 실제 DB를 호출하지 않는다.

운영 검증은 학생 0명인 별도 반에서 고정 예문으로 수행했다.
The little bird opens its wings and flies over the green garden.
WaveNet F의 일반 4.104초, 0.7배속 5.808초를 실제 합성하여 DB/Storage에 저장했다.
페이지 재접속 후 목소리와 URL이 유지됐고 기존 플레이어에서 두 파일 모두 ended=true였다.
오프라인 전사에서 마지막 garden을 포함한 12단어가 일치했고 느린 파일에는 -40dB 기준
200ms 이상 문장 내부 무음이 없었다. 실제 학생 정보를 합성하지 않았다.
다른 9종의 실제 합성·청취와 학생 계정 로그인 재생은 수행하지 않았다.
운영 장애를 일부러 발생시키지 않았으며 실패 복구는 모의 테스트로 검증했다.

WaveNet 무료 한도 소진 후 백만 자당 US$4 기준으로 일반+0.7배속은 원문 1,000자당
약 US$0.008이다. 검증 128자(64자 × 2)의 예상 비용은 US$0.000512였다.
사용량은 기존 tts 기록에 음성 ID와 글자 수로 집계하며 실제 청구액은 Google 기준이다.
가격: https://cloud.google.com/text-to-speech/pricing

## 배포와 복구

기본 브랜치는 claude/intelligent-cori-f2mga1, 운영용 브랜치는 main이다.
두 브랜치에 같은 변경을 유지하여 이후 배포에서 이번 기능이 사라지지 않도록 한다.
OpenAI 제거는 이번 작업에 포함하지 않는다. 새 배포 확인에 추가 유료 합성은 필요 없다.
문제가 생기면 WAVENET_ENABLED를 비활성화한 새 배포나 Vercel의 이전 검증 배포로 복구한다.
기존 MP3·DB URL은 지우지 않는다. 초기 WaveNet 검증 배포는
dpl_41PUATeaxwCyFDe7z2AG2BRKAVPW, 그 이전 배포는 dpl_4wU3Y3rWQJcVw6PTxw1QhjJx4hbD다.
