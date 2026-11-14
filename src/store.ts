import { initializeApp } from 'firebase/app'
import { getDatabase, ref, onValue, update, push, serverTimestamp, query, limitToLast, type Database } from 'firebase/database'

// 가족 화면의 데이터. 약속은 docs/firebase-약속.md.
// .env.local 에 VITE_FIREBASE_DB_URL 이 있으면 진짜 Firebase, 없으면 "가짜 집"(ESP32 판단을 흉내)으로 돈다.

export type AlertType = 'none' | 'sos' | 'fall' | 'inactive'
export type EventType = 'motion' | 'inactive_warn' | 'inactive_alert' | 'sos' | 'fall' | 'fall_cancel' | 'med_taken' | 'med_missed' | 'ack'

export interface Home {
  status: { lastMotion?: number; level?: 0 | 1 | 2; nightMode?: boolean; heartbeat?: number }
  alert: { type: AlertType; at?: number; acked?: boolean; ackAt?: number }
  meds: Record<string, { morning?: { taken: boolean; at: number }; evening?: { taken: boolean; at: number } }>
  events: { id: string; type: EventType; at: number; detail?: string }[]
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

export function makeSource(): Source {
  return DB_URL ? firebaseSource(DB_URL) : fakeSource()
}

// ───────── 진짜 Firebase ─────────

function firebaseSource(url: string): Source {
  const db: Database = getDatabase(initializeApp({ databaseURL: url }))
  return {
    kind: 'firebase',
    subscribe(cb) {
      let home: Home = { ...EMPTY }
      const emit = () => cb({ ...home })
      const offs = [
        onValue(ref(db, 'home/status'), (s) => { home.status = s.val() ?? {}; emit() }),
        onValue(ref(db, 'home/alert'), (s) => { home.alert = s.val() ?? { type: 'none' }; emit() }),
        onValue(ref(db, 'home/meds'), (s) => { home.meds = s.val() ?? {}; emit() }),
        onValue(ref(db, '.info/serverTimeOffset'), (s) => { home.offset = s.val() ?? 0; emit() }),
        // 사건 기록은 최근 50개만
        onValue(query(ref(db, 'home/events'), limitToLast(50)), (s) => {
          const list: Home['events'] = []
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
// ESP32 와 같은 규칙으로 판단한다: 15초 무활동 → 주의, 30초 → 위험 경보 (시연 값).

export const DEMO = { warnSec: 15, alertSec: 30 }

export class FakeHome {
  home: Home
  private cb: (h: Home) => void = () => {}
  private timer = 0
  constructor() {
    const now = Date.now()
    this.home = {
      status: { lastMotion: now, level: 0, nightMode: false, heartbeat: now },
      alert: { type: 'none' },
      meds: { [dayKey(now)]: { morning: { taken: true, at: now - 3 * 3600_000 } } },
      events: [
        { id: 'e3', type: 'motion', at: now - 20 * 60_000 },
        { id: 'e2', type: 'med_taken', at: now - 3 * 3600_000, detail: '아침 약' },
        { id: 'e1', type: 'motion', at: now - 3.2 * 3600_000 },
      ],
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
    this.home.events = [{ id: String(Math.random()), type, at: Date.now(), detail }, ...this.home.events].slice(0, 50)
  }
  private raise(type: AlertType) { this.home.alert = { type, at: Date.now(), acked: false } }

  private tick() {
    const s = this.home.status
    s.heartbeat = Date.now()
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
    if (Date.now() - lastLogged > 60_000) this.log('motion')
    this.emit()
  }
  sos() { this.raise('sos'); this.log('sos'); this.emit() }
  fall() { this.raise('fall'); this.log('fall'); this.emit() }
  med(slot: 'morning' | 'evening', taken: boolean) {
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

/** 베트남 시각 기준 날짜 "2026-11-14" */
export function dayKey(ms: number) {
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
}
