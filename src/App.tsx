import { useEffect, useMemo, useRef, useState } from 'react'
import { DEMO, EMPTY, TZ, dayKey, makeSource, responseTimes, startOfDay, type EventType, type Home, type HomeEvent } from './store'

// 곁에 — 가족 화면. 멀리 사는 가족이 폰으로 연다 (심사위원은 QR로).
// ESP32 가 Firebase 에 쓴 상태를 실시간으로 보여 주고, 경보가 오면 [확인했어요] 로 집 안 부저를 끈다.

const OFFLINE_SEC = 30         // 기기 신호가 이만큼 끊기면 "연결 끊김"

interface Settings { elder: string; phone: string; place: string }
const DEFAULT_SETTINGS: Settings = { elder: '할머니', phone: '', place: '서울' }

const EVENT_TEXT: Record<EventType, string> = {
  motion: '움직임 감지', inactive_warn: '움직임 없음 (주의)', inactive_alert: '움직임 없음 (위험)',
  sos: 'SOS 버튼', fall: '낙상 의심 경보', fall_cancel: '낙상 감지 → [괜찮아요] 눌러 취소',
  med_taken: '약 드심', med_missed: '약 안 드심', ack: '가족이 확인함',
}
const EVENT_TONE: Partial<Record<EventType, string>> = {
  sos: 'text-red-600', fall: 'text-red-600', inactive_alert: 'text-red-600',
  med_missed: 'text-amber-600', inactive_warn: 'text-amber-600', fall_cancel: 'text-amber-600', ack: 'text-emerald-700 dark:text-emerald-400',
}

export default function App() {
  const source = useMemo(() => makeSource(), [])
  const [home, setHome] = useState<Home>(EMPTY)
  const [now, setNow] = useState(Date.now())
  const [acking, setAcking] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  const [settings, setSettings] = useState<Settings>(() => {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('gyeote.settings') ?? '{}') } } catch { return DEFAULT_SETTINGS }
  })
  useEffect(() => { try { localStorage.setItem('gyeote.settings', JSON.stringify(settings)) } catch { /* 저장 못 해도 화면은 돈다 */ } }, [settings])

  useEffect(() => source.subscribe(setHome), [source])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const serverNow = now + (home.offset ?? 0)
  const { status, alert } = home
  const alertOn = !!alert.type && alert.type !== 'none'
  const beatAgo = status.heartbeat ? (serverNow - status.heartbeat) / 1000 : Infinity
  const online = beatAgo < OFFLINE_SEC
  const elder = settings.elder || '할머니'
  const countdown = status.fallCountdownUntil ? Math.max(0, Math.ceil((status.fallCountdownUntil - serverNow) / 1000)) : 0

  // 새 경보가 오면 폰을 울린다 (진동 + 삐 소리 + 맨 위로 + 탭 제목)
  const lastAlertAt = useRef(0)
  useEffect(() => {
    if (!alertOn || alert.acked || !alert.at || alert.at === lastAlertAt.current) return
    lastAlertAt.current = alert.at
    navigator.vibrate?.([400, 200, 400, 200, 400])
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (soundOn) beep()
  }, [alertOn, alert.at, alert.acked, soundOn])
  useEffect(() => { document.title = alertOn && !alert.acked ? '[긴급] 곁에' : '곁에 — 가족 화면' }, [alertOn, alert.acked])

  async function ack() {
    setAcking(true)
    try { await source.ack() } finally { setAcking(false) }
  }

  const level = !online ? 'off' : alertOn && !alert.acked ? 'danger' : status.level === 2 ? 'danger' : status.level === 1 || countdown ? 'warn' : 'ok'
  const levelUi = {
    ok: ['bg-emerald-500', '괜찮으세요', '평소처럼 움직이고 계세요.'],
    warn: ['bg-amber-500', '움직임이 뜸해요', '조금 더 지켜보고, 길어지면 전화해 보세요.'],
    danger: ['bg-red-600', '확인이 필요해요', '지금 연락해 보세요.'],
    off: ['bg-neutral-400', '기기 연결 끊김', '집 와이파이나 전원이 꺼졌을 수 있어요. 집 안 경보는 그대로 울려요.'],
  }[level]

  const ALERT_TEXT = {
    sos: { title: `${elder}가 SOS 버튼을 누르셨어요`, hint: '바로 전화해 보세요. 안 받으시면 가까운 분께 부탁하세요.' },
    fall: { title: '넘어지신 것 같아요', hint: '충격이 감지되고 10초 동안 [괜찮아요]를 누르지 않으셨어요.' },
    inactive: { title: '오랫동안 움직임이 없어요', hint: '주무시는 중일 수도 있어요. 전화로 확인해 보세요.' },
  } as const
  const alertText = ALERT_TEXT[alert.type as keyof typeof ALERT_TEXT]

  return (
    <main className="min-h-dvh bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="mr-auto">
              <h1 className="text-xl font-bold">곁에</h1>
              <p className="text-xs text-neutral-500">{settings.place} {elder} 댁 · 카메라 없이 센서로만 지켜요</p>
            </div>
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${online ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800'}`}>
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'}`} />
              {online ? `기기 신호 ${Math.round(beatAgo)}초 전` : '연결 끊김'}
            </span>
          </div>
          <p className="flex gap-3 text-xs text-neutral-500 tabular-nums">
            <span>{settings.place} {clock(serverNow, 'Asia/Seoul')}</span>
            <span>호치민 {clock(serverNow)}</span>
            {source.kind === 'fake' && <span className="ml-auto rounded bg-neutral-200 px-1.5 dark:bg-neutral-800">시연 모드</span>}
          </p>
        </header>

        {/* 낙상 카운트다운: 아직 경보 전, 어르신이 [괜찮아요]를 누를 시간 */}
        {countdown > 0 && (
          <section className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 dark:bg-amber-950">
            <p className="text-sm text-amber-800 dark:text-amber-200">충격이 감지됐어요</p>
            <p className="mt-1 text-xl font-bold">넘어지셨는지 확인하는 중</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-4xl font-bold tabular-nums">{countdown}</span>
              <p className="text-sm text-neutral-600 dark:text-neutral-300">초 안에 {elder}가 [괜찮아요]를 누르지 않으시면 경보가 와요.</p>
            </div>
            <div className="mt-3 h-1.5 rounded bg-amber-200"><div className="h-1.5 rounded bg-amber-500 transition-all" style={{ width: `${(countdown / DEMO.fallSec) * 100}%` }} /></div>
          </section>
        )}

        {/* 경보 */}
        {alertOn && (
          <section className={`rounded-2xl p-5 text-white ${alert.acked ? 'bg-neutral-600' : 'bg-red-600'}`}>
            <p className="text-sm opacity-80">{clock(alert.at ?? serverNow)} · {ago(serverNow, alert.at)}</p>
            <p className="mt-1 text-2xl font-bold">{alertText?.title ?? '경보'}</p>
            <p className="mt-2 text-sm opacity-90">{alertText?.hint}</p>
            {alert.acked
              ? <p className="mt-4 text-sm">확인했어요 {alert.ackAt ? `(${clock(alert.ackAt)}, ${Math.round((alert.ackAt - (alert.at ?? alert.ackAt)) / 1000)}초 만에)` : ''} · 집 안 경보를 끄는 중…</p>
              : <div className="mt-4 grid grid-cols-2 gap-2">
                  <a href={settings.phone ? `tel:${settings.phone}` : undefined} onClick={(e) => { if (!settings.phone) { e.preventDefault(); document.getElementById('settings')?.setAttribute('open', '') ; document.getElementById('settings')?.scrollIntoView({ behavior: 'smooth' }) } }}
                    className="rounded-xl border-2 border-white py-3 text-center text-lg font-bold">
                    {settings.phone ? `${elder}께 전화` : '번호 등록'}
                  </a>
                  <button onClick={ack} disabled={acking} className="rounded-xl bg-white py-3 text-lg font-bold text-red-700 disabled:opacity-60">
                    {acking ? '보내는 중…' : '확인했어요'}
                  </button>
                  <p className="col-span-2 text-xs opacity-80">[확인했어요]를 누르면 {elder} 댁 부저가 꺼져요. 가족이 알았다는 뜻이에요.</p>
                </div>}
          </section>
        )}

        {/* 지금 상태 */}
        <section className="card">
          <div className="flex items-center gap-3">
            <span className={`h-4 w-4 rounded-full ${levelUi[0]}`} />
            <div>
              <p className="text-lg font-bold">{levelUi[1]}</p>
              <p className="text-xs text-neutral-500">{levelUi[2]}</p>
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-sm text-neutral-500">마지막 활동</p>
              <p className="text-4xl font-bold tabular-nums">{status.lastMotion ? ago(serverNow, status.lastMotion) : '기록 없음'}</p>
              {status.lastMotion && <p className="text-sm text-neutral-500">{clock(status.lastMotion)} 거실에서 움직임</p>}
            </div>
            <IdleMeter idle={status.lastMotion ? (serverNow - status.lastMotion) / 1000 : 0} night={!!status.nightMode} demo={source.kind === 'fake'} />
          </div>
          {status.nightMode && <p className="mt-3 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">밤 시간이라 움직임 없음 경고를 쉬고 있어요. SOS와 낙상은 그대로 알려요.</p>}
          <Timeline events={home.events} now={serverNow} />
        </section>

        {/* 약 */}
        <Meds home={home} now={serverNow} />

        {/* 경보 응답 */}
        <Responses events={home.events} />

        {/* 기록 */}
        <Log events={home.events} />

        {/* 작동 구조 */}
        <Flow home={home} now={serverNow} online={online} kind={source.kind} />

        {!soundOn && (
          <button className="btn w-full" onClick={() => { setSoundOn(true); beep(true) }}>경보 소리 켜기 (폰 규칙상 한 번 눌러야 해요)</button>
        )}

        {/* 설정 */}
        <details id="settings" className="card">
          <summary className="cursor-pointer text-sm font-medium text-neutral-500">설정 · 호칭과 전화번호</summary>
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2"><span className="w-16 text-neutral-500">호칭</span><input className="input flex-1" value={settings.elder} onChange={(e) => setSettings({ ...settings, elder: e.target.value })} /></label>
            <label className="flex items-center gap-2"><span className="w-16 text-neutral-500">사시는 곳</span><input className="input flex-1" value={settings.place} onChange={(e) => setSettings({ ...settings, place: e.target.value })} /></label>
            <label className="flex items-center gap-2"><span className="w-16 text-neutral-500">전화번호</span><input className="input flex-1" type="tel" placeholder="+82 10-0000-0000" value={settings.phone} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} /></label>
            <p className="text-xs text-neutral-500">이 폰에만 저장돼요. 경보가 오면 [전화] 버튼이 이 번호로 걸어요.</p>
          </div>
        </details>

        {/* 가짜 집: 하드웨어 없이 시연·테스트할 때만 보인다 */}
        {source.kind === 'fake' && source.fake && (
          <section className="rounded-2xl border border-dashed border-neutral-400 p-4">
            <p className="text-sm font-medium">시연용 가짜 집 <span className="font-normal text-neutral-500">— 센서 대신 누른다. {DEMO.warnSec}초 무활동 주의, {DEMO.alertSec}초 위험, 낙상 {DEMO.fallSec}초 카운트다운</span></p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <button className="btn" onClick={() => source.fake!.motion()}>손 흔들기</button>
              <button className="btn" onClick={() => source.fake!.sos()}>SOS</button>
              <button className="btn" onClick={() => source.fake!.fall()}>낙상</button>
              <button className="btn" disabled={!countdown} onClick={() => source.fake!.imOk()}>괜찮아요</button>
              <button className="btn" onClick={() => source.fake!.med('evening', true)}>저녁 약 열기</button>
              <button className="btn" onClick={() => source.fake!.med('evening', false)}>저녁 약 놓침</button>
              <button className="btn col-span-3" onClick={() => source.fake!.night(!status.nightMode)}>밤 모드 {status.nightMode ? '끄기' : '켜기'}</button>
            </div>
          </section>
        )}

        <p className="pb-4 text-center text-xs text-neutral-400">2026 KIS HCMC SW융합 해커톤 · 디지털 기술로 만드는 건강한 일상</p>
      </div>
    </main>
  )
}

/** 무활동 게이지: 주의·위험 기준까지 얼마나 찼나 */
function IdleMeter({ idle, night, demo }: { idle: number; night: boolean; demo: boolean }) {
  const pct = Math.min(1, idle / DEMO.alertSec)
  const color = idle >= DEMO.alertSec ? '#dc2626' : idle >= DEMO.warnSec ? '#f59e0b' : '#10b981'
  const r = 22, c = 2 * Math.PI * r
  return (
    <div className="text-center">
      <svg width="64" height="64" viewBox="0 0 64 64" className={night ? 'opacity-30' : ''}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 32 32)" />
        <text x="32" y="37" textAnchor="middle" fontSize="13" fontWeight="bold" fill="currentColor">{Math.round(pct * 100)}%</text>
      </svg>
      <p className="text-[10px] text-neutral-500">경고 기준까지{demo ? ` (${DEMO.alertSec}초)` : ''}</p>
    </div>
  )
}

/** 오늘 활동: 1시간 칸마다 움직임 기록 수 */
function Timeline({ events, now }: { events: HomeEvent[]; now: number }) {
  const day0 = startOfDay(now)
  const counts = Array(24).fill(0) as number[]
  for (const e of events) if (e.type === 'motion' && e.at >= day0 && e.at <= now) counts[Math.floor((e.at - day0) / 3_600_000)]++
  const max = Math.max(3, ...counts)
  const curHour = Math.floor((now - day0) / 3_600_000)
  const activeHours = counts.filter((n) => n > 0).length
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-neutral-500">오늘 활동</p>
        <p className="text-xs text-neutral-500">움직임이 있었던 시간 {activeHours}시간</p>
      </div>
      <div className="mt-2 flex h-14 items-end gap-[2px]">
        {counts.map((n, h) => (
          <div key={h} className="flex h-full flex-1 items-end" title={`${h}시: ${n}번`}>
            <div className={`w-full rounded-sm ${h === curHour ? 'bg-emerald-500' : h > curHour ? 'bg-transparent' : n ? 'bg-emerald-300 dark:bg-emerald-800' : 'bg-neutral-200 dark:bg-neutral-800'}`}
              style={{ height: h > curHour ? 0 : `${Math.max(8, (n / max) * 100)}%`, minHeight: h > curHour ? 0 : 3 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400"><span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>24시</span></div>
    </div>
  )
}

function Meds({ home, now }: { home: Home; now: number }) {
  const days = Array.from({ length: 7 }, (_, i) => dayKey(now - (6 - i) * 86_400_000))
  const today = home.meds[days[6]] ?? {}
  let taken = 0, total = 0
  for (const d of days) for (const s of ['morning', 'evening'] as const) { const m = home.meds[d]?.[s]; if (m) { total++; if (m.taken) taken++ } }
  return (
    <section className="card">
      <div className="flex items-baseline justify-between">
        <h2 className="label">오늘 약</h2>
        {total > 0 && <p className="text-xs text-neutral-500">최근 7일 복용 {taken}/{total}회 ({Math.round((taken / total) * 100)}%)</p>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {(['morning', 'evening'] as const).map((slot) => {
          const m = today[slot]
          return (
            <div key={slot} className={`rounded-xl border p-3 ${m ? (m.taken ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950' : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950') : 'border-neutral-200 dark:border-neutral-800'}`}>
              <p className="text-sm text-neutral-500">{slot === 'morning' ? '아침' : '저녁'}</p>
              <p className="mt-1 text-lg font-bold">{m ? (m.taken ? '✓ 드셨어요' : '✗ 안 드셨어요') : '아직'}</p>
              <p className="text-xs text-neutral-500">{m ? `${clock(m.at)} 약통 ${m.taken ? '열림' : '안 열림'}` : '약통이 열리면 표시돼요'}</p>
            </div>
          )
        })}
      </div>
      <table className="mt-4 w-full text-center text-xs">
        <thead><tr className="text-neutral-400"><th className="w-10" />{days.map((d) => <th key={d} className="font-normal">{d.slice(8)}일</th>)}</tr></thead>
        <tbody>
          {(['morning', 'evening'] as const).map((s) => (
            <tr key={s}>
              <td className="py-1 text-left text-neutral-500">{s === 'morning' ? '아침' : '저녁'}</td>
              {days.map((d) => {
                const m = home.meds[d]?.[s]
                return <td key={d} className="p-0.5"><div className={`mx-auto grid h-6 place-items-center rounded ${!m ? 'bg-neutral-100 text-neutral-300 dark:bg-neutral-800' : m.taken ? 'bg-emerald-500 text-white' : 'bg-amber-400 text-white'}`}>{!m ? '·' : m.taken ? '✓' : '✗'}</div></td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Responses({ events }: { events: HomeEvent[] }) {
  const list = responseTimes(events).slice(0, 5)
  if (list.length === 0) return null
  const done = list.filter((r) => r.sec !== null)
  const avg = done.length ? Math.round(done.reduce((s, r) => s + r.sec!, 0) / done.length) : null
  const name = { sos: 'SOS', fall: '낙상', inactive_alert: '무활동' } as Record<string, string>
  return (
    <section className="card">
      <div className="flex items-baseline justify-between">
        <h2 className="label">경보와 가족 확인</h2>
        {avg !== null && <p className="text-xs text-neutral-500">평균 {dur(avg)} 만에 확인</p>}
      </div>
      <ul className="mt-2 space-y-1.5 text-sm">
        {list.map((r) => (
          <li key={r.at} className="flex items-center gap-3">
            <span className="w-24 shrink-0 tabular-nums text-neutral-500">{dateShort(r.at)} {clock(r.at)}</span>
            <span className="text-red-600">{name[r.type]}</span>
            <span className={`ml-auto ${r.sec === null ? 'text-amber-600' : 'text-neutral-600 dark:text-neutral-300'}`}>{r.sec === null ? '아직 확인 안 됨' : `${dur(r.sec)} 만에 확인`}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Log({ events }: { events: HomeEvent[] }) {
  const [all, setAll] = useState(false)
  const shown = (all ? events : events.filter((e) => e.type !== 'motion')).slice(0, 15)
  return (
    <section className="card">
      <div className="flex items-center justify-between">
        <h2 className="label">기록</h2>
        <button className="text-xs text-neutral-500 underline" onClick={() => setAll(!all)}>{all ? '중요한 것만' : '움직임까지 모두'}</button>
      </div>
      <ul className="mt-2 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
        {shown.length === 0 && <li className="py-2 text-neutral-500">아직 기록이 없어요.</li>}
        {shown.map((e) => (
          <li key={e.id} className="flex gap-3 py-2">
            <span className="w-20 shrink-0 tabular-nums text-neutral-500">{dateShort(e.at)} {clock(e.at)}</span>
            <span className={EVENT_TONE[e.type] ?? ''}>{EVENT_TEXT[e.type] ?? e.type}{e.detail ? ` · ${e.detail}` : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 작동 구조: 센서 → ESP32 → Firebase → 가족 폰. 새 기록이 들어오면 그 길에 불이 들어온다. */
function Flow({ home, now, online, kind }: { home: Home; now: number; online: boolean; kind: 'firebase' | 'fake' }) {
  const latest = home.events[0]
  const flash = latest && now - latest.at < 2500
  const sensorOf: Partial<Record<EventType, string>> = { motion: 'PIR', inactive_warn: 'PIR', inactive_alert: 'PIR', sos: 'SOS 버튼', fall: '마이크로비트', fall_cancel: '마이크로비트', med_taken: '약통 IR', med_missed: '약통 IR', ack: '가족 폰' }
  const nodes = [
    { name: '센서', sub: 'PIR · SOS 버튼 · 약통 적외선 · 마이크로비트 가속도', on: flash },
    { name: 'ESP32', sub: '판단: 무활동 시간, 약 시간 창, 낙상 10초. 인터넷이 끊겨도 집 안 부저는 울린다', on: flash || online },
    { name: kind === 'fake' ? '가짜 DB (시연)' : 'Firebase 실시간 DB', sub: '상태·경보·약·기록을 저장하고 바로 밀어 준다', on: flash },
    { name: '가족 폰', sub: '이 화면. [확인했어요] → DB → ESP32 → 부저 끔', on: true },
  ]
  return (
    <section className="card">
      <h2 className="label">어떻게 작동하나요</h2>
      <ol className="mt-3 space-y-0">
        {nodes.map((n, i) => (
          <li key={n.name} className="relative flex gap-3 pb-4 last:pb-0">
            {i < nodes.length - 1 && <span className={`absolute left-[7px] top-4 h-full w-0.5 ${flash ? 'bg-emerald-400' : 'bg-neutral-200 dark:bg-neutral-800'}`} />}
            <span className={`relative mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${n.on ? 'border-emerald-500 bg-emerald-400' : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900'} ${flash ? 'animate-ping-once' : ''}`} />
            <div>
              <p className="font-medium">{n.name}</p>
              <p className="text-xs text-neutral-500">{n.sub}</p>
            </div>
          </li>
        ))}
      </ol>
      {latest && (
        <p className="mt-3 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          마지막 신호: {clock(latest.at)} {sensorOf[latest.type] ?? ''} → {EVENT_TEXT[latest.type]}
        </p>
      )}
    </section>
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
const dur = (s: number) => s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`
const clock = (t: number, timeZone = TZ) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
const dateShort = (t: number) => {
  const d = dayKey(t), today = dayKey(Date.now())
  return d === today ? '' : `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`
}

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
