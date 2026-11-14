import { initializeApp } from 'firebase/app'
import { getDatabase, ref, onValue, update, push, serverTimestamp, query, limitToLast, type Database } from 'firebase/database'

// 가족 화면의 데이터. 약속은 docs/firebase-약속.md.
// .env.local 에 VITE_FIREBASE_DB_URL 이 있으면 진짜 Firebase, 없으면(또는 주소 끝 ?demo) "가짜 집"(ESP32 판단을 흉내)으로 돈다.

export type AlertType = 'none' | 'sos' | 'fall' | 'inactive'
export type EventType = 'motion' | 'inactive_warn' | 'inactive_alert' | 'sos' | 'fall' | 'fall_cancel' | 'med_taken' | 'med_missed' | 'ack'
export type MedSlot = 'morning' | 'evening'

export interface HomeEvent { id: string; type: EventType; at: number; detail?: string }

export interface Home {
  status: {
    lastMotion?: number
    level?: 0 | 1 | 2
    nightMode?: boolean
    heartbeat?: number
    fallCountdownUntil?: number   // 낙상 감지 뒤 10초 카운트다운이 끝나는 시각 (진행 중일 때만)
  }
  alert: { type: AlertType; at?: number; acked?: boolean; ackAt?: number }
  meds: Record<string, Partial<Record<MedSlot, { taken: boolean; at: number }>>>
  events: HomeEvent[]                // 최신이 앞
  /** 서버 시각 - 폰 시각 (ms). '몇 분 전'을 정확히 계산하려고 */
  offset?: number
}

export const EMPTY: Home = { status: {}, alert: { type: 'none' }, meds: {}, events: [] }

export interface Source {
  kind: 'firebase' | 'fake'
  subscribe(cb: (h: Home) => void): () => void
  ack(): Promise<void>
  fake?: FakeHome
}

const DB_URL = import.meta.env.VITE_FIREBASE_DB_URL as string | undefined
/** 주소 뒤에 ?demo 를 붙이면 Firebase 가 있어도 가짜 집으로 연다 (발표 때 기기가 안 될 때 대비) */
export const DEMO_FORCED = new URLSearchParams(location.search).has('demo')

export function makeSource(): Source {
  return DB_URL && !DEMO_FORCED ? firebaseSource(DB_URL) : fakeSource()
}

// ───────── 진짜 Firebase ─────────

function firebaseSource(url: string): Source {
  const db: Database = getDatabase(initializeApp({ databaseURL: url }))
  return {
    kind: 'firebase',
    subscribe(cb) {
      const home: Home = { ...EMPTY }
      const emit = () => cb({ ...home })
      const offs = [
        onValue(ref(db, 'home/status'), (s) => { home.status = s.val() ?? {}; emit() }),
        onValue(ref(db, 'home/alert'), (s) => { home.alert = s.val() ?? { type: 'none' }; emit() }),
        onValue(ref(db, 'home/meds'), (s) => { home.meds = s.val() ?? {}; emit() }),
        onValue(ref(db, '.info/serverTimeOffset'), (s) => { home.offset = s.val() ?? 0; emit() }),
        // 사건 기록은 최근 300개 (움직임은 1분에 한 번만 기록되니 하루치 활동 그림에 충분)
        onValue(query(ref(db, 'home/events'), limitToLast(300)), (s) => {
          const list: HomeEvent[] = []
          s.forEach((c) => { list.push({ id: c.key!, ...c.val() }) })
          home.events = list.reverse()
          emit()
        }),
      ]
      return () => offs.forEach((off) => off())
    },
    async ack() {
      // ESP32 는 alert/acked 가 true 가 되면 부저를 끈다
      await update(ref(db, 'home/alert'), { acked: true, ackAt: serverTimestamp() })
      await push(ref(db, 'home/events'), { type: 'ack', at: serverTimestamp() })
    },
  }
}

// ───────── 가짜 집 (하드웨어 없이 시연·테스트) ─────────
// ESP32 와 같은 규칙으로 판단한다: 15초 무활동 → 주의, 30초 → 위험 경보, 낙상 뒤 10초 카운트다운 (시연 값).

export const DEMO = { warnSec: 15, alertSec: 30, fallSec: 10 }

const MIN = 60_000, HOUR = 3_600_000

export class FakeHome {
  home: Home
  private cb: (h: Home) => void = () => {}
  private timer = 0

  constructor() {
    const now = Date.now()
    const events: HomeEvent[] = []
    const ev = (type: EventType, at: number, detail?: string) => events.push({ id: `${type}-${at}`, type, at, detail })
    const today0 = startOfDay(now)

    // 지난 6일: 아침 약은 거의 매일, 저녁 약은 두 번 놓침. 그저께 오후에 무활동 경보 → 가족이 1분 35초 만에 확인
    const meds: Home['meds'] = {}
    for (let d = 6; d >= 1; d--) {
      const day0 = today0 - d * 24 * HOUR
      meds[dayKey(day0 + 12 * HOUR)] = {
        morning: { taken: d !== 4, at: day0 + 8 * HOUR + (d * 7) % 25 * MIN },
        evening: { taken: d !== 2 && d !== 5, at: day0 + 19 * HOUR + (d * 11) % 30 * MIN },
      }
    }
    const twoDaysAgo = today0 - 2 * 24 * HOUR
    ev('inactive_alert', twoDaysAgo + 15 * HOUR + 10 * MIN)
    ev('ack', twoDaysAgo + 15 * HOUR + 11 * MIN + 35_000)

    // 오늘: 6시 반 기상 → 오전 활동 → 점심 뒤 낮잠(조용) → 오후 활동 → 지금까지
    const busy: [number, number, number][] = [[6.5, 9.5, 4], [9.5, 12.5, 9], [12.5, 13.2, 3], [14.6, 18, 6], [18, 22, 5]]
    for (const [from, to, every] of busy) {
      for (let t = today0 + from * HOUR; t < Math.min(today0 + to * HOUR, now - 2 * MIN); t += every * MIN + ((t / MIN) % 3) * MIN) ev('motion', t)
    }
    if (now > today0 + 8.2 * HOUR) { ev('med_taken', today0 + 8 * HOUR + 12 * MIN, '아침 약'); meds[dayKey(now)] = { morning: { taken: true, at: today0 + 8 * HOUR + 12 * MIN } } }
    ev('motion', now - 5_000)

    events.sort((a, b) => b.at - a.at)
    this.home = {
      status: { lastMotion: now - 5_000, level: 0, nightMode: false, heartbeat: now },
      alert: { type: 'none' },
      meds,
      events: events.slice(0, 300),
    }
  }

  start(cb: (h: Home) => void) {
    this.cb = cb
    this.timer = window.setInterval(() => this.tick(), 1000)
    this.emit()
  }
  stop() { clearInterval(this.timer) }
  private emit() { this.cb({ ...this.home, status: { ...this.home.status }, alert: { ...this.home.alert }, events: [...this.home.events] }) }
  private log(type: EventType, detail?: string) {
    this.home.events = [{ id: String(Math.random()), type, at: Date.now(), detail }, ...this.home.events].slice(0, 300)
  }
  private raise(type: AlertType) { this.home.alert = { type, at: Date.now(), acked: false } }

  private tick() {
    const s = this.home.status
    s.heartbeat = Date.now()
    // 낙상 카운트다운이 끝나면 경보
    if (s.fallCountdownUntil && Date.now() >= s.fallCountdownUntil) {
      s.fallCountdownUntil = undefined
      this.raise('fall'); this.log('fall')
    }
    const idle = (Date.now() - (s.lastMotion ?? Date.now())) / 1000
    if (!s.nightMode) {
      if (idle >= DEMO.alertSec && s.level !== 2) { s.level = 2; this.log('inactive_alert'); if (this.home.alert.type === 'none') this.raise('inactive') }
      else if (idle >= DEMO.warnSec && idle < DEMO.alertSec && s.level !== 1) { s.level = 1; this.log('inactive_warn') }
    }
    this.emit()
  }

  // 시연 버튼들 = 센서 흉내
  motion() {
    const s = this.home.status
    const lastLogged = this.home.events.find((e) => e.type === 'motion')?.at ?? 0
    s.lastMotion = Date.now(); s.level = 0
    if (Date.now() - lastLogged > MIN) this.log('motion')
    this.emit()
  }
  sos() { this.raise('sos'); this.log('sos'); this.emit() }
  /** 마이크로비트가 충격을 감지 → 10초 카운트다운 시작 (괜찮아요로 취소 가능) */
  fall() { this.home.status.fallCountdownUntil = Date.now() + DEMO.fallSec * 1000; this.emit() }
  imOk() {
    if (!this.home.status.fallCountdownUntil) return
    this.home.status.fallCountdownUntil = undefined
    this.log('fall_cancel'); this.motion()
  }
  med(slot: MedSlot, taken: boolean) {
    const k = dayKey(Date.now())
    this.home.meds = { ...this.home.meds, [k]: { ...this.home.meds[k], [slot]: { taken, at: Date.now() } } }
    this.log(taken ? 'med_taken' : 'med_missed', slot === 'morning' ? '아침 약' : '저녁 약')
    this.emit()
  }
  night(on: boolean) { this.home.status.nightMode = on; this.emit() }
  async ack() {
    // ESP32 가 하는 일까지 흉내: 확인되면 경보를 내린다
    this.home.alert = { ...this.home.alert, acked: true, ackAt: Date.now() }
    this.log('ack')
    this.emit()
    setTimeout(() => { this.home.alert = { type: 'none' }; this.emit() }, 1500)
  }
}

function fakeSource(): Source {
  const fake = new FakeHome()
  return {
    kind: 'fake',
    fake,
    subscribe(cb) { fake.start(cb); return () => fake.stop() },
    ack: () => fake.ack(),
  }
}

export const TZ = 'Asia/Ho_Chi_Minh'

/** 베트남 시각 기준 날짜 "2026-11-14" */
export function dayKey(ms: number) {
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: TZ })
}

/** 베트남 시각 기준 그날 0시 (ms). 베트남은 서머타임이 없어 UTC+7 고정 */
export function startOfDay(ms: number) {
  const off = 7 * HOUR
  return Math.floor((ms + off) / (24 * HOUR)) * 24 * HOUR - off
}

/** 경보와 그 뒤 첫 확인을 짝지어 "몇 초 만에 확인했나" */
export function responseTimes(events: HomeEvent[]) {
  const asc = [...events].sort((a, b) => a.at - b.at)
  const out: { type: EventType; at: number; sec: number | null }[] = []
  for (let i = 0; i < asc.length; i++) {
    const e = asc[i]
    if (e.type !== 'sos' && e.type !== 'fall' && e.type !== 'inactive_alert') continue
    const ack = asc.slice(i + 1).find((x) => x.type === 'ack')
    out.push({ type: e.type, at: e.at, sec: ack ? Math.round((ack.at - e.at) / 1000) : null })
  }
  return out.reverse()
}
