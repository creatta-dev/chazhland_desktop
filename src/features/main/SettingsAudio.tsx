import { useEffect, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { voice, MIC_RMS_FULL, type AudioDevice } from '@/lib/voice'
import { sfx } from '@/lib/sfx'
import { Switch } from '@/components/ui'

function keyLabel(code: string) {
  if (code === 'Space') return 'Пробел'
  if (code.startsWith('Mouse')) {
    const MB: Record<string, string> = { '1': 'Колесо (СКМ)', '2': 'Правая кнопка', '3': 'Мышь 4 (назад)', '4': 'Мышь 5 (вперёд)' }
    return MB[code.slice(5)] ?? 'Мышь ' + code.slice(5)
  }
  return code.replace('Key', '').replace('Digit', '').replace('Control', 'Ctrl')
}

/** Вкладка «Аудио» центра настроек: устройства, проверка микрофона (слышу себя), обработка, режим, порог, звуки. */
export function SettingsAudio() {
  const [inputs, setInputs] = useState<AudioDevice[]>([])
  const [outputs, setOutputs] = useState<AudioDevice[]>([])
  const [s, setS] = useState({ ...voice.settings })
  const [capturing, setCapturing] = useState(false)
  const [grantBusy, setGrantBusy] = useState(false)
  const [sounds, setSounds] = useState(sfx.enabled)
  const [level, setLevel] = useState(0)           // живой уровень микрофона (0..1 по шкале MIC_RMS_FULL)
  const [monitoring, setMonitoring] = useState(false) // активна ли прослушка себя

  useEffect(() => {
    let alive = true
    const load = async () => { const d = await voice.listDevices(); if (alive) { setInputs(d.inputs); setOutputs(d.outputs) } }
    ;(async () => { await voice.requestMicPermission(); await load() })() // грант сразу — иначе метки устройств пустые
    const md = navigator.mediaDevices
    md?.addEventListener('devicechange', load)
    return () => { alive = false; md?.removeEventListener('devicechange', load); voice.stopMicMonitor() }
  }, [])

  async function grant() {
    setGrantBusy(true)
    await voice.requestMicPermission()
    const d = await voice.listDevices()
    setInputs(d.inputs); setOutputs(d.outputs)
    setGrantBusy(false)
  }

  // Живой замер уровня для калибровки порога — ТОЛЬКО когда НЕ идёт прослушка (иначе двойной захват мика).
  // Во время прослушки уровень даёт сам монитор (см. toggleMonitor).
  useEffect(() => {
    if (monitoring) return
    let raf = 0, ctx: AudioContext | null = null, stream: MediaStream | null = null, stopped = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: s.inputId ? { deviceId: { exact: s.inputId }, noiseSuppression: false } : { noiseSuppression: false } })
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        ctx = new Ctor(); if (ctx.state === 'suspended') void ctx.resume()
        const analyser = ctx.createAnalyser(); analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)
        const buf = new Float32Array(analyser.fftSize)
        const loop = () => {
          analyser.getFloatTimeDomainData(buf)
          let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) / MIC_RMS_FULL))
          raf = requestAnimationFrame(loop)
        }
        loop()
      } catch { /* нет доступа — индикатор не двигается */ }
    })()
    return () => { stopped = true; if (raf) cancelAnimationFrame(raf); if (ctx) { try { void ctx.close() } catch { /* */ } } if (stream) stream.getTracks().forEach((t) => t.stop()) }
  }, [s.inputId, monitoring])

  async function toggleMonitor() {
    if (monitoring) { voice.stopMicMonitor(); setMonitoring(false); setLevel(0); return }
    const ok = await voice.startMicMonitor((l) => setLevel(l)) // монитор сам отдаёт уровень
    setMonitoring(ok)
  }

  useEffect(() => {
    if (!capturing) return
    const apply = (code: string) => { voice.setPttKey(code); setS((p) => ({ ...p, pttKey: code })); setCapturing(false) }
    const hk = (e: KeyboardEvent) => { e.preventDefault(); apply(e.code) }
    const hm = (e: MouseEvent) => { if (e.button === 0) return; e.preventDefault(); apply('Mouse' + e.button) } // левую не назначаем (обычный клик)
    window.addEventListener('keydown', hk)
    window.addEventListener('mousedown', hm)
    return () => { window.removeEventListener('keydown', hk); window.removeEventListener('mousedown', hm) }
  }, [capturing])

  return (
    <div>
      <Section label="Микрофон (ввод)">
        <Select value={s.inputId} onChange={(v) => { voice.setInputDevice(v); setS((p) => ({ ...p, inputId: v })) }} options={[{ id: '', label: 'По умолчанию' }, ...inputs]} />
      </Section>
      <Section label="Устройство вывода">
        <Select value={s.outputId} onChange={(v) => { voice.setOutputDevice(v); setS((p) => ({ ...p, outputId: v })) }} options={[{ id: '', label: 'По умолчанию' }, ...outputs]} />
        {inputs.length === 0 && (
          <div style={{ marginTop: 8 }}>
            <Hint>Нет доступа к микрофону — разрешите, чтобы увидеть список устройств.</Hint>
            <button className="pill no-drag" onClick={grant} disabled={grantBusy} style={{ marginTop: 8, padding: '7px 13px', fontWeight: 600, fontSize: 13 }}>{grantBusy ? 'Запрос…' : 'Запросить доступ'}</button>
          </div>
        )}
      </Section>
      <Section label="Проверка микрофона">
        <button className={monitoring ? 'danger-btn no-drag' : 'accent-btn no-drag'} onClick={toggleMonitor} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 12, padding: '10px 16px', fontWeight: 700, fontSize: 13.5 }}>
          {monitoring ? <><Square size={15} /> Остановить проверку</> : <><Mic size={15} /> Проверить микрофон</>}
        </button>
        <div style={{ position: 'relative', height: 10, borderRadius: 6, background: 'var(--surface-2)', overflow: 'hidden', marginTop: 10 }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.round(level * 100)}%`, background: 'var(--green)', transition: 'width .05s linear' }} />
        </div>
        <Hint>{monitoring ? 'Говорите — вы должны слышать себя в наушниках/колонках. Постучите по клавиатуре и подвигайте мышью, чтобы оценить шумоподавление.' : 'Включите, чтобы услышать себя так, как вас слышат другие (с текущим шумоподавлением).'}</Hint>
      </Section>
      <Section label="Обработка звука">
        <Toggle label="Шумоподавление" on={s.noiseSuppression} onClick={() => { const v = !s.noiseSuppression; voice.setProcessing({ noiseSuppression: v }); setS((p) => ({ ...p, noiseSuppression: v })) }} />
        {s.noiseSuppression && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <ModeBtn active={s.noiseSuppressor === 'rnnoise'} onClick={() => { voice.setProcessing({ noiseSuppressor: 'rnnoise' }); setS((p) => ({ ...p, noiseSuppressor: 'rnnoise' })) }} title="Нейросеть (RNNoise)" desc="давит клавиши/мышь/гул" />
            <ModeBtn active={s.noiseSuppressor === 'browser'} onClick={() => { voice.setProcessing({ noiseSuppressor: 'browser' }); setS((p) => ({ ...p, noiseSuppressor: 'browser' })) }} title="Браузерный" desc="встроенный WebRTC-шумодав" />
          </div>
        )}
        <Hint>Нейросетевой (RNNoise) — клиентский, хорошо давит стук клавиатуры, клики мыши и фоновый гул. Браузерный — встроенный в WebRTC; на некоторых микрофонах звучит естественнее. Работает только один — одновременно оба включать нельзя (стакаются в «роботный» голос).</Hint>
        <Toggle label="Эхоподавление" on={s.echoCancellation} onClick={() => { const v = !s.echoCancellation; voice.setProcessing({ echoCancellation: v }); setS((p) => ({ ...p, echoCancellation: v })) }} />
        <Toggle label="Авто-громкость (AGC)" on={s.autoGain} onClick={() => { const v = !s.autoGain; voice.setProcessing({ autoGain: v }); setS((p) => ({ ...p, autoGain: v })) }} />
      </Section>
      <Section label="Режим передачи">
        <div style={{ display: 'flex', gap: 8 }}>
          <ModeBtn active={s.mode === 'voice'} onClick={() => { voice.setMode('voice'); setS((p) => ({ ...p, mode: 'voice' })) }} title="Голосовая активация" desc="микрофон всегда открыт" />
          <ModeBtn active={s.mode === 'ptt'} onClick={() => { voice.setMode('ptt'); setS((p) => ({ ...p, mode: 'ptt' })) }} title="Рация (PTT)" desc="говорить по клавише" />
        </div>
        {s.mode === 'ptt' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 11, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Кнопка передачи:</span>
            <span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 600, padding: '4px 11px', borderRadius: 8, background: 'var(--surface-2)' }}>{keyLabel(s.pttKey)}</span>
            <button className="pill no-drag" onClick={() => setCapturing(true)} style={{ padding: '6px 12px', fontWeight: 600 }}>{capturing ? 'Нажмите клавишу/кнопку мыши…' : 'Изменить'}</button>
          </div>
        )}
      </Section>
      <Section label="Порог реагирования микрофона">
        <input type="range" min={0} max={100} value={Math.round(s.micThreshold * 100)} className="no-drag" onChange={(e) => { const v = Number(e.target.value) / 100; voice.setMicThreshold(v); setS((p) => ({ ...p, micThreshold: v })) }} style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }} />
        <div style={{ position: 'relative', height: 10, borderRadius: 6, background: 'var(--surface-2)', overflow: 'hidden', marginTop: 8 }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.round(level * 100)}%`, background: level >= s.micThreshold ? 'var(--green)' : 'var(--text-3)', transition: 'width .05s linear' }} />
          <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${Math.round(s.micThreshold * 100)}%`, width: 2, background: 'var(--accent)' }} />
        </div>
        <Hint>{s.micThreshold === 0 ? 'Гейт выключен — микрофон передаёт всегда.' : 'Говорите: полоска должна переходить за метку. Ниже метки микрофон молчит. Действует в режиме голосовой активации. Хорошо отсекает клавиатуру/мышь в паузах.'}</Hint>
      </Section>
      <Section label="Звуки">
        <Toggle label="Звуки действий и уведомлений (мут, вход/выход, упоминания, ЛС)" on={sounds} onClick={() => { const v = !sounds; sfx.setEnabled(v); setSounds(v); if (v) sfx.micOn() }} />
        <Toggle label="Слышать саундпад других" on={!s.soundboardMuted} onClick={() => { const muted = !s.soundboardMuted; voice.setSoundboardMuted(muted); setS((p) => ({ ...p, soundboardMuted: muted })) }} />
      </Section>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  )
}
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: AudioDevice[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="no-drag" style={{ width: '100%', padding: '10px 12px', borderRadius: 11, border: '1px solid var(--border-2)', background: 'var(--win)', color: 'var(--text)', font: 'inherit', fontSize: 13.5, cursor: 'pointer' }}>
      {options.map((o, i) => <option key={o.id || `default-${i}`} value={o.id}>{o.label}</option>)}
    </select>
  )
}
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <Switch checked={on} onChange={onClick} size="sm" label={label} style={{ width: '100%', padding: '7px 0' }} />
}
function ModeBtn({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button onClick={onClick} className="no-drag" style={{ flex: 1, textAlign: 'left', border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-tint)' : 'var(--surface)', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', color: active ? 'var(--accent)' : 'var(--text)' }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{desc}</div>
    </button>
  )
}
function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>{children}</div>
}
