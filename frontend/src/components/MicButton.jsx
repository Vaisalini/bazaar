import { useEffect, useRef, useState } from 'react'
import { transcribeAudio } from '../agents/gemini'

// records mic audio, then transcribes it with Gemini (proxy-safe, works in all browsers)
export function useSpeech(setText) {
  const [state, setState] = useState('idle') // idle | recording | transcribing
  const [seconds, setSeconds] = useState(0)
  const recRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const baseRef = useRef('')

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  useEffect(() => () => clearInterval(timerRef.current), [])

  async function toggle(currentText) {
    if (!supported || state === 'transcribing') return

    if (state === 'recording') {
      recRef.current?.stop()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      baseRef.current = (currentText || '').trim()
      chunksRef.current = []
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data)
      rec.onstop = async () => {
        clearInterval(timerRef.current)
        stream.getTracks().forEach((t) => t.stop())
        setState('transcribing')
        try {
          const blob = new Blob(chunksRef.current, { type: mime })
          const base64 = await new Promise((resolve) => {
            const r = new FileReader()
            r.onloadend = () => resolve(r.result.split(',')[1])
            r.readAsDataURL(blob)
          })
          const text = await transcribeAudio(base64, mime)
          if (text) setText(baseRef.current ? `${baseRef.current} ${text}` : text)
        } catch (err) {
          console.warn('transcription failed', err)
        } finally {
          setState('idle')
          setSeconds(0)
        }
      }
      recRef.current = rec
      rec.start()
      setState('recording')
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (err) {
      console.warn('mic access failed', err)
      setState('idle')
    }
  }

  return { supported, state, seconds, toggle }
}

export function MicButton({ supported, state, seconds, onClick }) {
  if (!supported) return null
  const label =
    state === 'recording' ? `⏺ ${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
    : state === 'transcribing' ? '…'
    : '🎤'
  return (
    <button
      onClick={onClick}
      disabled={state === 'transcribing'}
      title={
        state === 'recording' ? 'Stop recording'
        : state === 'transcribing' ? 'Transcribing with Gemini…'
        : 'Record a voice note'
      }
      className={`px-4 rounded-xl border text-sm font-mono transition min-w-[64px] ${
        state === 'recording'
          ? 'bg-red-500/20 border-red-500 text-red-300 animate-pulse'
          : state === 'transcribing'
            ? 'bg-slate-800 border-slate-600 text-slate-400'
            : 'bg-slate-900 border-slate-700 hover:border-amber-400 text-lg'
      }`}
    >
      {label}
    </button>
  )
}
