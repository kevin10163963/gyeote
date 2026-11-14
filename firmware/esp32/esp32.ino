// 곁에 — ESP32 펌웨어 (집 안 판단 담당)
// 센서를 읽고 판단해서 집 안 부저·LED를 울리고, 결과를 Firebase 에 쓴다. 데이터 약속: docs/firebase-약속.md
// 판단은 ESP32 가 한다 → 인터넷이 끊겨도 집 안 경보는 울린다.
//
// 보드: "ESP32 Dev Module" (Vietduino ESP32 도 이걸로 올린다)

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>

// ───── 1. 여기만 바꾼다 ─────
const char* WIFI_SSID = "폰핫스팟이름";      // 2.4GHz 핫스팟이어야 한다 (5GHz 는 ESP32 가 못 잡는다)
const char* WIFI_PASS = "핫스팟비밀번호";
const char* DB = "https://kis-hackathon-live-default-rtdb.asia-southeast1.firebasedatabase.app";

const bool DEMO = true;   // true: 시연용 짧은 시간 / false: 실제 생활 기준
// 무활동 기준: 시연 15초·30초 / 실제 2시간·4시간 (근거 조사 후 보고서에 적는다)
const unsigned long WARN_MS  = DEMO ? 15000UL : 2UL * 3600000UL;
const unsigned long ALERT_MS = DEMO ? 30000UL : 4UL * 3600000UL;
const unsigned long FALL_COUNTDOWN_MS = 10000;  // 낙상 뒤 [괜찮아요] 기다리는 시간
// 약 시간 창: 실제는 아침 8시·저녁 7시 ±30분. 시연은 켠 뒤 0~2분 = 아침, 2~4분 = 저녁
const int MED_HOUR[2] = {8, 19};
const unsigned long DEMO_MED_WINDOW_MS = 120000UL;
const int NIGHT_START = 22, NIGHT_END = 6;      // 밤에는 무활동 경고를 쉰다 (실제 모드만)

// ───── 2. 핀 (팀 배선표) ─────
const int PIN_PIR = 35;      // 입력 전용 핀
const int PIN_MED_IR = 34;   // 입력 전용 핀. 약통 뚜껑 안쪽을 본다
const int PIN_SOS = 33;      // 버튼 ↔ GND (내부 풀업)
const int PIN_OK = 32;       // [괜찮아요] 버튼 ↔ GND (내부 풀업)
const int PIN_FALL = 4;      // 마이크로비트 P0 (GND 끼리 꼭 연결)
const int PIN_BUZZ = 18;
const int PIN_RED = 19, PIN_GREEN = 23;
const bool MED_OPEN_IS_HIGH = true;  // 적외선 센서는 물체가 가까우면 LOW. 뚜껑이 열려 물체가 멀어지면 HIGH

// ───── 상태 ─────
enum Alert { NONE, SOS, FALL, INACTIVE };
Alert alert = NONE;
int level = 0;                         // 0 정상, 1 주의, 2 위험
unsigned long lastMotionMs = 0, lastMotionSent = 0, lastMotionEvent = 0;
unsigned long fallUntil = 0;           // 낙상 카운트다운 끝나는 millis (0 = 없음)
unsigned long lastBeat = 0, lastAckCheck = 0, bootMs = 0;
bool medDone[2] = {false, false};      // 오늘(시연: 이번 회차) 이 칸을 기록했나
int lastMedDay = -1;
bool prevSos = HIGH, prevOk = HIGH, prevFall = LOW, prevMedOpen = false;

WiFiClientSecure tls;

// ───── Firebase REST ─────
// 시각 자리에 {".sv":"timestamp"} 를 쓰면 서버가 지금 시각으로 바꿔 준다 → ESP32 시계가 틀려도 된다
const char* TS = "{\".sv\":\"timestamp\"}";

bool fb(const char* method, const String& path, const String& body, String* out = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.setTimeout(3000);
  if (!http.begin(tls, String(DB) + path + ".json")) return false;
  http.addHeader("Content-Type", "application/json");
  int code = http.sendRequest(method, body);
  if (out && code == 200) *out = http.getString();
  http.end();
  if (code != 200) Serial.printf("[DB] %s %s -> %d\n", method, path.c_str(), code);
  return code == 200;
}

void event(const char* type, const char* detail = nullptr) {
  String b = String("{\"type\":\"") + type + "\",\"at\":" + TS;
  if (detail) b += String(",\"detail\":\"") + detail + "\"";
  fb("POST", "/home/events", b + "}");
}

void setStatus(const String& fields) { fb("PATCH", "/home/status", "{" + fields + "}"); }

void raise(Alert a) {
  if (alert != NONE && alert != INACTIVE && a == INACTIVE) return;  // 더 급한 경보가 있으면 덮지 않는다
  alert = a;
  const char* t = a == SOS ? "sos" : a == FALL ? "fall" : "inactive";
  fb("PUT", "/home/alert", String("{\"type\":\"") + t + "\",\"at\":" + TS + ",\"acked\":false}");
}

void clearAlert() {
  alert = NONE;
  noTone(PIN_BUZZ);
  fb("PATCH", "/home/alert", "{\"type\":\"none\"}");
}

// ───── 시간 (약·밤 판단용, NTP) ─────
bool timeOk() { struct tm t; return getLocalTime(&t, 10); }
int hourNow() { struct tm t; return getLocalTime(&t, 10) ? t.tm_hour : -1; }
int minuteOfDay() { struct tm t; return getLocalTime(&t, 10) ? t.tm_hour * 60 + t.tm_min : -1; }
int yday() { struct tm t; return getLocalTime(&t, 10) ? t.tm_yday : -1; }
String dateKey() {
  struct tm t;
  if (!getLocalTime(&t, 10)) return "unknown";
  char buf[11]; strftime(buf, sizeof buf, "%Y-%m-%d", &t);
  return buf;
}
bool isNight() {
  if (DEMO) return false;
  int h = hourNow();
  return h >= 0 && (h >= NIGHT_START || h < NIGHT_END);
}

// ───── 출력: LED·부저 ─────
void outputs(unsigned long now) {
  bool alarm = alert != NONE;
  bool counting = fallUntil != 0;
  // LED: 초록 정상, 노랑(빨+초) 주의·카운트다운, 빨강 경보 (경보는 깜빡임)
  bool blink = (now / 300) % 2;
  digitalWrite(PIN_RED, alarm ? blink : (level >= 1 || counting));
  digitalWrite(PIN_GREEN, !alarm && level < 2);
  // 부저: 경보 = 삐-삐-, 카운트다운 = 1초마다 짧게
  if (alarm) { if ((now / 400) % 2) tone(PIN_BUZZ, 2000); else noTone(PIN_BUZZ); }
  else if (counting) { if (now % 1000 < 80) tone(PIN_BUZZ, 1500); else noTone(PIN_BUZZ); }
  else noTone(PIN_BUZZ);
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("와이파이 연결 중");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " 연결됨" : " 실패 (집 안 경보는 계속 동작)");
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_MED_IR, INPUT);
  pinMode(PIN_SOS, INPUT_PULLUP);
  pinMode(PIN_OK, INPUT_PULLUP);
  pinMode(PIN_FALL, INPUT_PULLDOWN);
  pinMode(PIN_RED, OUTPUT); pinMode(PIN_GREEN, OUTPUT);
  tls.setInsecure();                       // 대회용: 인증서 확인 생략 (보고서 한계점에 적는다)
  connectWifi();
  configTime(7 * 3600, 0, "pool.ntp.org", "time.google.com");   // 베트남 시각 (UTC+7)
  bootMs = millis();
  lastMotionMs = millis();
  setStatus(String("\"lastMotion\":") + TS + ",\"level\":0,\"nightMode\":false,\"heartbeat\":" + TS);
  fb("PUT", "/home/alert", "{\"type\":\"none\"}");
  Serial.println("곁에 시작");
}

void loop() {
  unsigned long now = millis();

  // 와이파이가 끊기면 30초마다 다시 시도 (그동안에도 집 안 판단은 계속)
  static unsigned long lastWifiTry = 0;
  if (WiFi.status() != WL_CONNECTED && now - lastWifiTry > 30000) { lastWifiTry = now; WiFi.reconnect(); }

  // ① 움직임 (PIR)
  if (digitalRead(PIN_PIR) == HIGH) {
    lastMotionMs = now;
    if (level != 0) { level = 0; setStatus("\"level\":0"); if (alert == INACTIVE) clearAlert(); }
    if (now - lastMotionSent > 5000) { lastMotionSent = now; setStatus(String("\"lastMotion\":") + TS); }     // DB 쓰기는 5초에 한 번
    if (now - lastMotionEvent > 60000 || lastMotionEvent == 0) { lastMotionEvent = now; event("motion"); }   // 기록은 1분에 한 번
  }

  // ② 무활동 판단 (밤에는 쉰다)
  bool night = isNight();
  static bool lastNight = false;
  if (night != lastNight) { lastNight = night; setStatus(String("\"nightMode\":") + (night ? "true" : "false")); }
  unsigned long idle = now - lastMotionMs;
  if (!night) {
    if (idle >= ALERT_MS && level != 2) { level = 2; setStatus("\"level\":2"); event("inactive_alert"); raise(INACTIVE); }
    else if (idle >= WARN_MS && idle < ALERT_MS && level != 1) { level = 1; setStatus("\"level\":1"); event("inactive_warn"); }
  }

  // ③ SOS 버튼 (눌린 순간만)
  bool sos = digitalRead(PIN_SOS);
  if (prevSos == HIGH && sos == LOW) { Serial.println("SOS"); event("sos"); raise(SOS); }
  prevSos = sos;

  // ④ 낙상: 마이크로비트가 P0 를 HIGH 로 → 10초 카운트다운 → [괜찮아요] 안 누르면 경보
  bool fall = digitalRead(PIN_FALL);
  if (prevFall == LOW && fall == HIGH && fallUntil == 0 && alert != FALL) {
    Serial.println("낙상 감지, 카운트다운");
    fallUntil = now + FALL_COUNTDOWN_MS;
    // 가족 화면에 카운트다운을 띄우려면 "서버 시각 + 10초"가 필요하다.
    // REST 로는 더하기를 못 하니: 서버 시각을 먼저 쓰고 → 읽어 와서 → 10초를 더해 다시 쓴다
    setStatus(String("\"fallCountdownUntil\":") + TS);
    String t;
    if (fb("GET", "/home/status/fallCountdownUntil", "", &t)) setStatus(String("\"fallCountdownUntil\":") + String(t.toDouble() + FALL_COUNTDOWN_MS, 0));
  }
  prevFall = fall;
  bool ok = digitalRead(PIN_OK);
  if (prevOk == HIGH && ok == LOW && fallUntil) {
    Serial.println("괜찮아요 → 낙상 취소");
    fallUntil = 0; lastMotionMs = now;
    setStatus("\"fallCountdownUntil\":null"); event("fall_cancel");
  }
  prevOk = ok;
  if (fallUntil && (long)(now - fallUntil) >= 0) {
    fallUntil = 0;
    setStatus("\"fallCountdownUntil\":null"); event("fall"); raise(FALL);
  }

  // ⑤ 약통: 시간 창 안에 뚜껑이 열리면 복용, 창이 끝날 때까지 안 열리면 미복용
  bool medOpen = (digitalRead(PIN_MED_IR) == HIGH) == MED_OPEN_IS_HIGH;
  int slot = -1; bool windowOver[2] = {false, false};
  if (DEMO) {
    unsigned long t = now - bootMs, cycle = t % (2 * DEMO_MED_WINDOW_MS);
    if (t / (2 * DEMO_MED_WINDOW_MS) != (unsigned long)lastMedDay) { lastMedDay = t / (2 * DEMO_MED_WINDOW_MS); medDone[0] = medDone[1] = false; }
    slot = cycle < DEMO_MED_WINDOW_MS ? 0 : 1;
    windowOver[0] = cycle >= DEMO_MED_WINDOW_MS;
    windowOver[1] = cycle >= 2 * DEMO_MED_WINDOW_MS - 1000;   // 저녁 창 끝나기 1초 전
  } else if (timeOk()) {
    if (yday() != lastMedDay) { lastMedDay = yday(); medDone[0] = medDone[1] = false; }
    int m = minuteOfDay();
    for (int i = 0; i < 2; i++) {
      int c = MED_HOUR[i] * 60;
      if (m >= c - 30 && m <= c + 30) slot = i;
      if (m > c + 30) windowOver[i] = true;
    }
  }
  const char* slotName[2] = {"morning", "evening"};
  const char* slotKo[2] = {"아침 약", "저녁 약"};
  if (!prevMedOpen && medOpen && slot >= 0 && !medDone[slot]) {
    medDone[slot] = true;
    Serial.printf("%s 복용\n", slotKo[slot]);
    fb("PUT", "/home/meds/" + dateKey() + "/" + slotName[slot], String("{\"taken\":true,\"at\":") + TS + "}");
    event("med_taken", slotKo[slot]);
  }
  prevMedOpen = medOpen;
  for (int i = 0; i < 2; i++) if (windowOver[i] && !medDone[i]) {
    medDone[i] = true;
    Serial.printf("%s 미복용\n", slotKo[i]);
    fb("PUT", "/home/meds/" + dateKey() + "/" + slotName[i], String("{\"taken\":false,\"at\":") + TS + "}");
    event("med_missed", slotKo[i]);
  }

  // ⑥ 경보 중이면 1초마다 가족이 [확인] 눌렀는지 본다
  if (alert != NONE && now - lastAckCheck > 1000) {
    lastAckCheck = now;
    String acked;
    if (fb("GET", "/home/alert/acked", "", &acked) && acked == "true") {
      Serial.println("가족 확인 → 부저 끔");
      if (alert == INACTIVE) lastMotionMs = now;   // 가족이 확인했으니 무활동 시계를 다시 시작
      level = 0; setStatus("\"level\":0");
      clearAlert();
    }
  }

  // ⑦ 10초마다 살아 있다는 신호
  if (now - lastBeat > 10000) { lastBeat = now; setStatus(String("\"heartbeat\":") + TS); }

  outputs(now);
  delay(20);
}
