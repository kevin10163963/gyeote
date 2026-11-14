# 해커톤 프로젝트 — KIS HCMC SW융합 해커톤 (2026-11-14, 9:00~20:00)

동우(고등학생, 기계공학 지망)가 팀으로 참가한다. 주제는 당일 발표되는 SDGs 17개 목표 중 하나.
학교 보드·센서(아두이노 Uno, 마이크로비트 V2 등)를 소프트웨어와 엮어야 한다.
**사전 제작 금지** — 이 폴더는 `npm create vite` 로 만든 빈 화면뿐이다. 프로젝트 코드는 전부 당일 새로 쓴다.
보고서 양식과 제작 규칙은 당일 안내된다. 받으면 그 규칙이 이 문서보다 우선한다.

한국어 "~다" 체로 짧게 말한다. 과장된 표현은 쓰지 않는다.

## 일하는 방식

- **돌아가는 것부터.** 센서 하나 → 값이 시리얼로 찍힘 → 화면에 보임, 이 한 줄을 가장 먼저 완성한다. 그다음에 넓힌다.
- 기능 하나 끝날 때마다 확인한다: 웹은 브라우저 미리보기(`web`), 보드는 시리얼 출력. 확인 못 했으면 못 했다고 말한다.
- 기능 하나가 돌아가면 바로 `git commit`.
- 막히면 10분 넘게 붙잡지 말고 더 단순한 방법으로 바꾼다. 바꿨다고 말한다.
- 동우에게 묻는 건 동우·팀이 정해야 하는 것(아이디어, 무엇을 버릴지, 배선 확인)만.

## 하드웨어

- 아두이노: `arduino-cli` (`~/.local/bin`). Uno 코어와 라이브러리가 깔려 있다:
  DHT sensor library, LiquidCrystal I2C, Adafruit NeoPixel, Servo, Adafruit SSD1306/GFX, U8g2, DFRobot_DHT11.
  ```bash
  arduino-cli board list                                   # 보드 꽂고 포트 확인
  arduino-cli compile --fqbn arduino:avr:uno firmware/
  arduino-cli upload  --fqbn arduino:avr:uno -p /dev/cu.usbmodemXXXX firmware/
  arduino-cli monitor -p /dev/cu.usbmodemXXXX -c baudrate=9600   # 값 확인 (끝낼 땐 Ctrl+C)
  ```
  스케치는 `firmware/firmware.ino`. 업로드 전 시리얼 모니터·웹 연결을 끊는다 (포트를 하나만 잡을 수 있다).
  포트가 안 보이면: 케이블이 충전 전용인지, 다른 USB 포트인지 먼저 본다. 복제 보드(CH340)는 `/dev/cu.wchusbserial*` 로 뜬다.
- 배선은 사람이 한다. 코드를 주기 전에 어느 핀에 무엇을 꽂는지 표로 먼저 준다 (센서 VCC/GND/신호 → 핀).
  5V/3.3V 를 헷갈리기 쉬운 센서는 따로 경고한다.
- 마이크로비트: makecode.microbit.org 에서 JavaScript/Python 탭에 붙여넣을 코드를 준다. 크롬에서 USB로 바로 내려받을 수 있다.
- 보드 → 웹 연결: 보드가 `Serial.println` 으로 한 줄에 하나씩 `키=값,키=값` 형식을 보내고,
  웹은 크롬의 Web Serial API(`navigator.serial`)로 읽는다. 연결 버튼은 사용자가 눌러야 한다(브라우저 규칙).
  보드가 없을 때를 위해 웹에 "가짜 데이터" 스위치를 둬서 시연이 멈추지 않게 한다.
  Web Serial 은 동우의 크롬(`http://localhost:5173`)에서 확인한다. 앱 안 미리보기 창에서는 안 될 수 있으니,
  미리보기로는 가짜 데이터 상태를 확인하고 실제 보드 연결은 크롬에서 동우에게 눌러 보게 한다.

## 웹

- React 19 + TypeScript + Vite + Tailwind 4. `npm run dev` 는 5173 포트. `@anthropic-ai/sdk` 는 설치돼 있다.
- 데이터는 처음엔 `localStorage`나 코드 안의 예시 데이터. 서버·DB는 꼭 필요할 때만.
- AI 기능(센서 값 해석, 조언, 보고서 문장 등)은 `src/ai.ts` 한 파일에 모은다. 당일 새로 쓴다. 쓰는 법:
  `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })` → `client.beta.messages.create({ model: 'claude-opus-5-5',
  max_tokens: 4000, output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system, messages })`.
  `stop_reason === 'refusal'` 을 먼저 확인하고, text 블록만 모은다. 키는 `.env.local` 의 `VITE_ANTHROPIC_API_KEY` (동우가 직접 넣는다, 커밋 금지).
  키가 없으면 실제 센서 값으로 만든 예시 답을 돌려줘서 시연이 멈추지 않게 한다. 이 이상이 필요할 때만 `claude-api` 스킬을 읽는다.
- 디자인: 담백하게. 흰/검 바탕, 회색 글자, 강조색 하나. 이모지 남발 금지.

## 마무리 (끝나기 1시간 전)

1. `/demo-ready` — 보드 꽂은 상태와 가짜 데이터 상태 둘 다 시연 흐름을 처음부터 끝까지 확인한다.
2. 당일 받은 보고서 양식을 채운다.
3. `/pitch` — 발표 슬라이드 (발표는 11월 17일).
