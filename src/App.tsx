import { useEffect, useMemo, useRef, useState } from 'react'
import { DEMO, EMPTY, dayKey, makeSource, type Home, type EventType } from './store'

// 곁에 — 가족 화면. 멀리 사는 가족이 폰으로 연다 (심사위원은 QR로).
// ESP32 가 Firebase 에 쓴 상태를 실시간으로 보여 주고, 경보가 오면 [확인] 으로 집 안 부저를 끈다.

const ELDER = '할머니'          // 화면에 쓰는 호칭
const OFFLINE_SEC = 30         // 기기 신호가 이만큼 끊기면 "연결 끊김"

const ALERT_TEXT = {
  sos: { title: `${ELDER}가 SOS 버튼을 누르셨어요`, hint: '바로 전화해 보세요. 안 받으시면 가까운 분께 부탁하세요.' },
  fall: { title: '넘어지신 것 같아요', hint: '충격이 감지되고 10초 동안 [괜찮아요]를 누르지 않으셨어요.' },
  inactive: { title: '오랫동안 움직임이 없어요', hint: '주무시는 중일 수도 있어요. 전화로 확인해 보세요.' },
} as const

const EVENT_TEXT: Record<EventType, string> = {
  motion: '움직임 감지', inactive_warn: '움직임 없음 (주의)', inactive_alert: '움직임 없음 (위험)',
  sos: 'SOS 버튼', fall: '낙상 의심', fall_cancel: '낙상 감지 → [괜찮아요] 눌러 취소',
  med_taken: '약 드심', med_missed: '약 안 드심', ack: '가족이 확인함',
}
const EVENT_TONE: Partial<Record<EventType, string>> = {
  sos: 'text-red-600', fall: 'text-red-600', inactive_alert: 'text-red-600', med_missed: 'text-amber-600', inactive_warn: 'text-amber-600',
}

export default function App() {
  const source = useMemo(() => makeSource(), [])
  const [home, setHome] = useState<Home>(EMPTY)
  const [now, setNow] = useState(Date.now())
  const [acking, setAcking] = useState(false)
  const [soundOn, setSoundOn] = useState(false)

  useEffect(() => source.subscribe(setHome), [source])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const serverNow = now + (home.offset ?? 0)
  const { status, alert } = home
  const alertOn = alert.type !== 'none' && !!alert.type
  const online = status.heartbeat ? (serverNow - status.heartbeat) / 1000 < OFFLINE_SEC : false
  const today = home.meds[dayKey(serverNow)] ?? {}

  // 새 경보가 오면 폰을 울린다 (진동 + 삐 소리 + 탭 제목)
  const lastAlertAt = useRef(0)
  useEffect(() => {
    if (!alertOn || alert.acked || !alert.at || alert.at === lastAlertAt.current) return
    lastAlertAt.current = alert.at
    navigator.vibrate?.([400, 200, 400, 200, 400])
    window.scrollTo({ top: 0, behavior: 'smooth' })   // 아래를 보고 있어도 경보가 눈에 들어오게
    if (soundOn) beep()
  }, [alertOn, alert.at, alert.acked, soundOn])
  useEffect(() => { document.title = alertOn && !alert.acked ? '[긴급] 곁에' : '곁에 — 가족 화면' }, [alertOn, alert.acked])

  async function ack() {
    setAcking(true)
    try { await source.ack() } finally { setAcking(false) }
  }

  const level = !online ? 'off' : alertOn && !alert.acked ? 'danger' : status.level === 2 ? 'danger' : status.level === 1 ? 'warn' : 'ok'
  const levelUi = {
    ok: ['bg-emerald-600', '괜찮으세요'],
    warn: ['bg-amber-500', '움직임이 뜸해요'],
    danger: ['bg-red-600', '확인이 필요해요'],
    off: ['bg-neutral-400', '기기 연결 끊김'],
  }[level]

  return (
    <main className="min-h-dvh bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <header className="flex items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-bold">곁에</h1>
            <p className="text-xs text-neutral-500">서울 {ELDER} 댁 · 카메라 없이 센서로만 지켜요</p>
          </div>
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${online ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800'}`}>
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-neutral-400'}`} />{online ? '기기 연결됨' : '연결 끊김'}
          </span>
        </header>

        {/* 경보 */}
        {alertOn && (
          <section className={`rounded-2xl p-5 text-white ${alert.acked ? 'bg-neutral-600' : 'bg-red-600 animate-[pulse_1.5s_ease-in-out_infinite]'}`}>
            <p className="text-sm opacity-80">{ago(serverNow, alert.at)}</p>
            <p className="mt-1 text-2xl font-bold">{ALERT_TEXT[alert.type as keyof typeof ALERT_TEXT]?.title ?? '경보'}</p>
            <p className="mt-2 text-sm opacity-90">{ALERT_TEXT[alert.type as keyof typeof ALERT_TEXT]?.hint}</p>
            {alert.acked
              ? <p className="mt-4 text-sm">확인했어요 {alert.ackAt ? `(${clock(alert.ackAt)})` : ''} · 집 안 경보를 끄는 중…</p>
              : <button onClick={ack} disabled={acking} className="mt-4 w-full rounded-xl bg-white py-3 text-lg font-bold text-red-700 disabled:opacity-60">
                  {acking ? '보내는 중…' : '확인했어요'}
                </button>}
          </section>
        )}

        {/* 지금 상태 */}
        <section className="card">
          <div className="flex items-center gap-3">
            <span className={`h-4 w-4 rounded-full ${levelUi[0]}`} />
            <p className="text-lg font-bold">{levelUi[1]}</p>
          </div>
          <p className="mt-4 text-sm text-neutral-500">마지막 활동</p>
          <p className="text-4xl font-bold tabular-nums">{status.lastMotion ? ago(serverNow, status.lastMotion) : '기록 없음'}</p>
          {status.lastMotion && <p className="text-sm text-neutral-500">{clock(status.lastMotion)} 거실에서 움직임</p>}
          {status.nightMode && <p className="mt-2 text-sm text-neutral-500">밤 시간이라 움직임 없음 경고를 쉬고 있어요.</p>}
        </section>

        {/* 오늘 약 */}
        <section className="card">
          <h2 className="label">오늘 약</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(['morning', 'evening'] as const).map((slot) => {
              const m = today[slot]
              return (
                <div key={slot} className={`rounded-xl border p-3 ${m ? (m.taken ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950' : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950') : 'border-neutral-200 dark:border-neutral-800'}`}>
                  <p className="text-sm text-neutral-500">{slot === 'morning' ? '아침' : '저녁'}</p>
                  <p className="mt-1 text-lg font-bold">{m ? (m.taken ? '✓ 드셨어요' : '✗ 안 드셨어요') : '아직'}</p>
                  {m && <p className="text-xs text-neutral-500">{clock(m.at)}</p>}
                </div>
              )
            })}
          </div>
        </section>

        {/* 사건 기록 */}
        <section className="card">
          <h2 className="label">기록</h2>
          <ul className="mt-2 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {home.events.length === 0 && <li className="py-2 text-neutral-500">아직 기록이 없어요.</li>}
            {home.events.slice(0, 15).map((e) => (
              <li key={e.id} className="flex gap-3 py-2">
                <span className="w-12 shrink-0 tabular-nums text-neutral-500">{clock(e.at)}</span>
                <span className={EVENT_TONE[e.type] ?? ''}>{EVENT_TEXT[e.type] ?? e.type}{e.detail ? ` · ${e.detail}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>

        {!soundOn && (
          <button className="btn w-full" onClick={() => { setSoundOn(true); beep(true) }}>경보 소리 켜기 (폰 규칙상 한 번 눌러야 해요)</button>
        )}

        {/* 가짜 집: 하드웨어 없이 시연·테스트할 때만 보인다 */}
        {source.kind === 'fake' && source.fake && (
          <section className="rounded-2xl border border-dashed border-neutral-400 p-4">
            <p className="text-sm font-medium">시연용 가짜 집 <span className="font-normal text-neutral-500">— Firebase 주소가 없거나 주소 끝에 ?demo 를 붙였을 때만 보인다. {DEMO.warnSec}초 무활동 주의, {DEMO.alertSec}초 위험</span></p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <button className="btn" onClick={() => source.fake!.motion()}>손 흔들기</button>
              <button className="btn" onClick={() => source.fake!.sos()}>SOS</button>
              <button className="btn" onClick={() => source.fake!.fall()}>낙상</button>
              <button className="btn" onClick={() => source.fake!.med('evening', true)}>저녁 약 열기</button>
              <button className="btn" onClick={() => source.fake!.med('evening', false)}>저녁 약 놓침</button>
              <button className="btn" onClick={() => source.fake!.night(!status.nightMode)}>밤 모드 {status.nightMode ? '끄기' : '켜기'}</button>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

function ago(now: number, t?: number) {
  if (!t) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 10) return '방금'
  if (s < 60) return `${s}초 전`
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분 전`
  return `${Math.floor(s / 86400)}일 전`
}

const clock = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' })

let audio: AudioContext | null = null
function beep(quiet = false) {
  audio ??= new AudioContext()
  const t = audio.currentTime
  for (let i = 0; i < (quiet ? 1 : 3); i++) {
    const o = audio.createOscillator(), g = audio.createGain()
    o.frequency.value = 880
    g.gain.setValueAtTime(quiet ? 0.05 : 0.3, t + i * 0.4)
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.4 + 0.3)
    o.connect(g).connect(audio.destination)
    o.start(t + i * 0.4); o.stop(t + i * 0.4 + 0.3)
  }
}
