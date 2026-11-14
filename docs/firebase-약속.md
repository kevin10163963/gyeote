# Firebase 실시간 DB 약속 (ESP32 ↔ 가족 화면)

ESP32(성훈)가 쓰고, 가족 화면(동우)이 읽는다. **[확인] 버튼만 가족 화면이 쓰고 ESP32가 읽는다.**
모든 경로는 `/home` 아래. 시각은 전부 **Firebase 서버 시각(ms)** 을 쓴다 → ESP32 시계(NTP)가 없어도 된다.
REST로 쓸 때 시각 자리에 `{".sv":"timestamp"}` 를 넣으면 서버가 지금 시각으로 바꿔 준다.

```
/home
  status
    lastMotion : 1794620000000     ← PIR 감지될 때마다 서버 시각으로 덮어쓴다
    level      : 0 | 1 | 2         ← 0 정상, 1 주의(노랑), 2 위험(빨강). 무활동 판단 결과
    nightMode  : true | false      ← 밤이라 무활동 경고를 끈 상태
    heartbeat  : 1794620000000     ← 10초마다 서버 시각. 가족 화면은 30초 넘게 안 바뀌면 "기기 연결 끊김"
  alert                            ← 지금 울리고 있는 경보 (하나만). 없으면 type 을 "none"
    type  : "none" | "sos" | "fall" | "inactive"
    at    : 1794620000000
    acked : false                  ← 가족이 [확인]을 누르면 화면이 true 로 바꾼다 → ESP32 가 보고 부저를 끈다
    ackAt : 1794620000000          ← (화면이 씀)
  meds
    2026-11-14                     ← 날짜 (베트남 시각 기준 YYYY-MM-DD)
      morning : { taken: true,  at: 1794620000000 }
      evening : { taken: false, at: 1794620000000 }   ← 시간 창(±30분)이 지났는데 안 열면 taken:false 로 쓴다
  events                           ← 사건 기록. POST(push)로 계속 추가만 한다
    -Nx...: { type: "motion" | "inactive_warn" | "inactive_alert" | "sos" | "fall" | "fall_cancel" | "med_taken" | "med_missed" | "ack",
              at: 1794620000000, detail: "아침 약" }
```

## ESP32에서 언제 무엇을 쓰나

| 일 | 쓰는 곳 |
|---|---|
| PIR 감지 | `status/lastMotion` = 서버 시각. (`events` 에 motion 은 1분에 한 번만, 너무 많아지지 않게) |
| 무활동 주의/위험 | `status/level` = 1 또는 2, `events` 에 inactive_warn / inactive_alert. 위험이면 `alert` = {type:"inactive", at, acked:false} |
| 다시 움직임 | `status/level` = 0 |
| SOS 버튼 | `alert` = {type:"sos", at, acked:false}, `events` 에 sos |
| 낙상 (10초 카운트다운 끝) | `alert` = {type:"fall", at, acked:false}, `events` 에 fall. [괜찮아요] 누르면 `events` 에 fall_cancel 만 |
| 약통 열림 (시간 창 안) | `meds/날짜/morning` = {taken:true, at}, `events` 에 med_taken |
| 10초마다 | `status/heartbeat` = 서버 시각 |
| `alert/acked` 가 true 가 됨 | 부저·빨강 LED 끄고 `alert/type` = "none" |

## REST 예시 (ESP32 HTTPClient)

```
PATCH https://<프로젝트>-default-rtdb.<지역>.firebasedatabase.app/home/status.json
  {"lastMotion": {".sv":"timestamp"}, "level": 0}

PUT   .../home/alert.json
  {"type":"sos", "at":{".sv":"timestamp"}, "acked":false}

POST  .../home/events.json
  {"type":"sos", "at":{".sv":"timestamp"}}

GET   .../home/alert/acked.json        ← 1초마다 확인 (경보 울리는 중일 때만)
```

DB 규칙은 대회 동안만 테스트 모드(읽기·쓰기 모두 허용)로 둔다. 대회 끝나면 꼭 닫는다. 보고서 "한계점"에 적는다.
