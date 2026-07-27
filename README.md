# ☀️ 캠스터디 — 실시간 캠스터디 웹 애플리케이션

참여자들이 **웹캠**과 **모니터 화면**을 공유하며 서로의 공부 모습을 보고 자극을 받는, 밝고 긍정적인(Bright & Light) 테마의 스터디 웹사이트입니다.

## ✅ 현재 완성된 기능

1. **초기 접속 & 권한 요청 플로우**
   - 접속 즉시 웹캠(`getUserMedia`)과 화면 공유(`getDisplayMedia`) 권한을 순차 요청
   - 각 권한의 승인/거부 상태를 배지로 표시, 거부 시 재시도 안내
   - 승인 완료 후 웹캠 미리보기 + 닉네임 입력 + **'공부 시작!'** 버튼 화면 표시
2. **메인 화면 (다중 분할 뷰)**
   - 세로로 긴 직사각형 유저 카드가 가로로 나열, **상단 절반 = 웹캠 / 하단 절반 = 화면 공유**
   - 인원이 많아지면 **가로 스크롤**로 탐색 (커스텀 스크롤바)
   - 내 카드는 민트색 테두리 + '나' 배지로 구분, 화면 공유 중단 감지 처리
3. **누적 공부 시간 기록 창**
   - 우측 하단 고정 **📖 플로팅 버튼** → 모달로 오늘의 랭킹(닉네임·누적 시간·온라인 여부·🥇🥈🥉) 표시
4. **유저 상세 화면 (더블 클릭)**
   - 유저 카드 더블 클릭 시 전체 화면 뷰 전환
   - 왼쪽 절반: 웹캠(상) + 모니터 화면(하) 확대 / 오른쪽 절반: 닉네임 + 누적 시간 대형 폰트 렌더링
5. **데이터 유지 & 초기화 로직**
   - 동일 닉네임 + 동일 '공부 날짜'로 재접속 시 누적 시간 **이어서 카운트** (Table API 조회)
   - '공부 날짜'는 **매일 오전 4시 기준**으로 계산(`now - 4시간`의 날짜 키) → 4시가 되면 자동으로 0부터 새 레코드 시작 (`setTimeout`으로 정확히 4AM에 리셋 예약)
   - 10초마다 하트비트로 서버 저장, 탭 종료 시 `beforeunload` + `keepalive` fetch로 마지막 시간 저장
   - 45초 이상 하트비트가 없으면 오프라인 처리되어 카드에서 제거

## 🔗 기능 진입 URI

| 경로 | 설명 |
|---|---|
| `index.html` | 단일 페이지 앱. 권한 요청 → 닉네임 → 메인 → 상세 화면이 JS로 전환 |
| `tables/study_records` (REST) | GET(목록)/POST(생성)/PATCH(시간·상태 갱신) 사용 |

## 🗄️ 데이터 모델 (`study_records`)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | text | 레코드 UUID (시스템) |
| `nickname` | text | 유저 닉네임 (재접속 식별 키) |
| `total_seconds` | number | 오늘 누적 공부 시간(초) |
| `study_day` | text | 오전 4시 기준 공부 날짜 키 `YYYY-MM-DD` |
| `is_online` | bool | 현재 접속 여부 |
| `last_seen` | number | 마지막 하트비트 (ms) |
| `avatar` | text | 닉네임 해시 기반 이모지 아바타 |

- 저장소: Genspark RESTful Table API (프리뷰: CosmosDB / Hosted 배포 시: Cloudflare D1)
- 닉네임/시간/온라인 상태는 5초 폴링으로 모든 접속자에게 동기화됩니다.

## ⚠️ 미구현 기능 — 원격 영상 스트림 (WebRTC)

**정적 웹사이트 환경에는 WebSocket 시그널링 서버를 둘 수 없어**, 다른 유저의 실제 웹캠/화면 영상 전송(P2P 미디어)은 이 프로젝트 범위에서 구현할 수 없습니다. 현재 원격 유저 카드에는 "실시간 연결 대기 중" 플레이스홀더가 표시되며, 닉네임·누적 시간·온라인 여부는 실시간 동기화됩니다.

### 실영상 공유로 확장하는 방법 (권장 순서)

1. **가장 쉬운 방법 — 관리형 SFU 서비스** (백엔드 불필요, 프론트 코드만 추가)
   - [LiveKit Cloud](https://livekit.io), [Daily.co](https://daily.co), [Agora](https://agora.io) 등의 JS SDK를 CDN으로 로드
   - `state.camStream` / `state.screenStream` 을 그대로 `room.localParticipant.publishTrack()`으로 발행
   - `RoomEvent.TrackSubscribed` 콜백에서 받은 원격 트랙을 `attachStream(half, remoteStream)` 으로 카드에 연결
   - ⚠️ 이 서비스들은 토큰 발급이 필요하므로 완전한 무인증 정적 호스팅과는 별도 토큰 서버(또는 서비스의 데모 토큰)가 필요
2. **직접 구축 — Socket.io 시그널링 + WebRTC Mesh**
   ```
   [Node.js + socket.io 서버]  ← join/offer/answer/ice 중계만 담당
   각 브라우저: RTCPeerConnection을 유저 수만큼 생성 (N-1개, ~6인 이하 권장)
   pc.addTrack(camTrack); pc.addTrack(screenTrack);  // 두 스트림 모두 발행
   pc.ontrack = (e) => { /* track의 stream id로 웹캠/화면 구분 후 카드에 부착 */ }
   ```
3. **Firebase Realtime DB를 시그널링 채널로 사용** — 서버 없이 offer/answer/ICE candidate를 DB 경로로 교환하는 방식도 가능 (Firebase 프로젝트 필요)

코드는 이 확장을 염두에 두고 작성되어 있습니다: 카드의 `.cam-half` / `.screen-half` 에 `attachStream()` 만 호출하면 원격 영상이 즉시 렌더링됩니다.

## 🚀 권장 다음 단계

1. LiveKit/Daily SDK 연동으로 실제 P2P 영상 스트림 구현
2. 뽀모도로 타이머 / 자리비움(웹캠 움직임 감지) 자동 일시정지
3. 주간·월간 누적 통계 차트 (Chart.js)
4. 응원 이모지 보내기 등 가벼운 상호작용

## 📦 파일 구조

```
index.html        # 4개 화면(권한/닉네임/메인/상세) + 랭킹 모달
css/style.css     # Bright & Light 테마, 카드 스트립, 상세뷰, 모달
js/app.js         # 미디어 권한, 타이머, 4AM 리셋, Table API 동기화, 랭킹, 상세뷰
```

## 🌐 배포

**Publish 탭**에서 원클릭으로 배포할 수 있습니다.
