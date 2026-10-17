import { useEffect, useState } from 'react'
import { onboardMessage } from '../agents/onboard'
import { MicButton, useSpeech } from './MicButton'

const WELCOME =
  "Namaste! 🙏 I'm your Bazaar agent. Tell me about your shop — what's it called, what do you sell, and your usual prices? You can write in English, Hindi, or Hinglish."

export default function OnboardChat() {
  const [messages, setMessages] = useState([{ role: 'agent', text: WELCOME }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [busySecs, setBusySecs] = useState(0)
  const [shop, setShop] = useState(null)
  const speech = useSpeech(setInput)

  useEffect(() => {
    if (!busy) { setBusySecs(0); return }
    const t = setInterval(() => setBusySecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  async function send() {
    if (!input.trim() || busy) return
    const next = [...messages, { role: 'owner', text: input }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const res = await onboardMessage(next)
      if (res.done) {
        setShop(res.profile)
        setMessages([
          ...next,
          {
            role: 'agent',
            text: `Done! "${res.profile.name}" is live on Bazaar. Your agent is now answering customers 24/7 and will negotiate within your prices. 🎉`,
          },
        ])
      } else {
        setMessages([...next, { role: 'agent', text: res.question }])
      }
    } catch {
      setMessages([...next, { role: 'agent', text: 'The agents are in high demand right now — please wait a few seconds and send that again. Your message is not lost.' }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-1">Put your shop on Bazaar in 5 minutes</h2>
      <p className="text-sm text-slate-400 mb-6">
        No forms. No catalogs. Just chat — your AI agent learns your shop and starts selling for you.
      </p>

      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex flex-col gap-3 min-h-[320px] max-h-[420px] overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'agent' ? 'justify-start' : 'justify-end'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.role === 'agent' ? 'bg-slate-800 text-slate-200' : 'bg-emerald-500/20 text-emerald-100'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <p className="text-xs text-slate-500 animate-pulse">
            {busySecs < 8
              ? 'agent is typing…'
              : busySecs < 25
                ? 'agent is thinking hard (high demand) — hang on…'
                : 'still working — free-tier agents queue up sometimes, almost there…'}
          </p>
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder='e.g. "Meri shop Royal Bakery hai, hum eggless cake banate hain, 1kg ₹450…"'
          className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-400"
        />
        <MicButton supported={speech.supported} state={speech.state} seconds={speech.seconds} onClick={() => speech.toggle(input)} />
        <button
          onClick={send}
          disabled={busy}
          className="bg-emerald-500 text-slate-950 font-semibold px-6 rounded-xl hover:bg-emerald-400 disabled:opacity-50"
        >
          Send
        </button>
      </div>

      {shop && (
        <div className="mt-6 bg-slate-900 border border-emerald-500/40 rounded-xl p-4 text-sm">
          <p className="text-emerald-300 font-semibold mb-2">Your agent's understanding of your shop:</p>
          <p><span className="text-slate-400">Name:</span> {shop.name} · <span className="text-slate-400">Category:</span> {shop.category}</p>
          <ul className="mt-2 space-y-1">
            {shop.items?.map((it, i) => (
              <li key={i} className="text-slate-300">
                {it.name} — ₹{it.basePrice} <span className="text-slate-500">(won't go below ₹{it.floorPrice})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
