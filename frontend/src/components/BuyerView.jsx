import { useEffect, useState } from 'react'
import { collection, doc, getCountFromServer, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { runRequest } from '../agents/orchestrator'
import ShopCard from './ShopCard'
import { MicButton, useSpeech } from './MicButton'

const SAMPLES = [
  'I need a 1kg eggless chocolate cake under ₹500, delivered in Andheri by 6pm',
  'Looking for boAt Airdopes earbuds, my budget is ₹1300, need them today',
  'Need a BP monitor for my father under ₹2000, fastest delivery wins',
]

export default function BuyerView() {
  const [text, setText] = useState('')
  const [requestId, setRequestId] = useState(null)
  const [need, setNeed] = useState(null)
  const [events, setEvents] = useState([])
  const [request, setRequest] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [stalled, setStalled] = useState(false)
  const [stats, setStats] = useState(null)
  const speech = useSpeech(setText)

  // permalink: restore a negotiation from ?r=<requestId> (survives refresh, shareable)
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('r')
    if (r) setRequestId(r)
  }, [])
  useEffect(() => {
    if (!need && request?.parsed) setNeed(request.parsed)
  }, [request, need])

  // live marketplace stats for the landing
  useEffect(() => {
    if (requestId) return
    ;(async () => {
      try {
        const [s, dealsSnap] = await Promise.all([
          getCountFromServer(collection(db, 'shops')),
          getDocs(query(collection(db, 'requests'), where('status', '==', 'completed'), limit(100))),
        ])
        const saved = dealsSnap.docs.reduce((sum, d) => sum + (d.data().deal?.savings || 0), 0)
        setStats({ shops: s.data().count, deals: dealsSnap.size, saved })
      } catch { /* stats are decorative */ }
    })()
  }, [requestId])

  // live negotiation stream from Firestore
  useEffect(() => {
    if (!requestId) return
    const unsubEvents = onSnapshot(
      query(collection(db, 'requests', requestId, 'events'), orderBy('ts')),
      (snap) => setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubReq = onSnapshot(doc(db, 'requests', requestId), (d) => setRequest(d.data()))
    return () => {
      unsubEvents()
      unsubReq()
    }
  }, [requestId])

  // watchdog: if negotiating but no new events for a while, reassure instead of looking frozen
  useEffect(() => {
    if (!requestId || request?.status !== 'negotiating') { setStalled(false); return }
    setStalled(false)
    const t = setTimeout(() => setStalled(true), 90000)
    return () => clearTimeout(t)
  }, [requestId, events.length, request?.status])

  async function start(queryText) {
    setError(null)
    setLoading(true)
    setEvents([])
    setRequest(null)
    try {
      const res = await runRequest(queryText)
      setNeed(res.need)
      setRequestId(res.requestId)
      window.history.replaceState(null, '', `?r=${res.requestId}`)
    } catch {
      setError('The agents are in high demand right now — give it a few seconds and try again.')
    } finally {
      setLoading(false)
    }
  }

  const shops = groupByShop(events)
  const done = request?.status === 'completed' || request?.status === 'no_deal'

  return (
    <div>
      {!requestId && (
        <div className="text-center py-12 animate-fade-up">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-4">agent-to-agent commerce</p>
          <h2 className="text-4xl sm:text-5xl font-black mb-4 leading-tight">
            One sentence.{' '}
            <span className="bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 bg-clip-text text-transparent">
              Your agent does the rest.
            </span>
          </h2>
          <p className="text-slate-400 mb-8 max-w-xl mx-auto">
            Tell your agent what you need. It talks to every local shop's agent in parallel,
            negotiates, and brings you the best deal — in about a minute.
          </p>
          <div className="flex flex-wrap justify-center gap-3 text-xs mb-2">
            {['1️⃣ You say what you need', '2️⃣ Agents negotiate live — watch the haggling', '3️⃣ Best deal confirmed with an order ticket'].map((s) => (
              <span key={s} className="bg-slate-900/80 border border-slate-800 rounded-full px-4 py-2 text-slate-400">
                {s}
              </span>
            ))}
          </div>
          {stats && (
            <p className="text-xs text-slate-500 mt-4">
              🏪 <span className="text-amber-300 font-semibold">{stats.shops}</span> shop agents online · 🤝{' '}
              <span className="text-amber-300 font-semibold">{stats.deals}</span> deals closed
              {stats.saved > 0 && (
                <>
                  {' '}· 💰 <span className="text-emerald-300 font-semibold">₹{stats.saved}</span> saved by buyer agents
                </>
              )}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 max-w-3xl mx-auto">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && start(text)}
          placeholder="e.g. I need a 1kg eggless chocolate cake under ₹500 by 6pm…"
          className="flex-1 bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-amber-400 focus:shadow-lg focus:shadow-amber-500/10 transition-shadow"
        />
        <div className="flex gap-2 justify-end">
          <MicButton supported={speech.supported} state={speech.state} seconds={speech.seconds} onClick={() => speech.toggle(text)} />
          <button
            onClick={() => text.trim() && start(text)}
            disabled={loading}
            className="bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 font-bold px-6 py-3 rounded-xl hover:brightness-110 active:scale-95 transition disabled:opacity-50 shadow-lg shadow-amber-500/20 whitespace-nowrap"
          >
            {loading ? 'Dispatching…' : 'Send agent →'}
          </button>
        </div>
      </div>

      {!requestId && (
        <div className="flex flex-wrap gap-2 justify-center mt-5">
          {SAMPLES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setText(s)
                start(s)
              }}
              className="text-xs bg-slate-900/80 border border-slate-700 rounded-full px-4 py-2 text-slate-300 hover:border-amber-400 hover:text-amber-200 hover:-translate-y-0.5 transition-all"
            >
              ✨ {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-center text-red-400 mt-4">{error}</p>}

      {requestId && need && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-slate-400">
                Your agent is negotiating for:{' '}
                <span className="text-slate-100 font-medium">{need.item}</span>
                {need.maxPrice > 0 && <> · budget ₹{need.maxPrice}</>}
                {need.location && <> · near {need.location}</>}
              </p>
            </div>
            {!done && (
              <span className="text-xs text-amber-400 animate-pulse">
                ● negotiating live — offers stream in as agents haggle (1–2 min)
              </span>
            )}
          </div>

          {request?.status === 'completed' && request.deal && (
            <WinnerBanner deal={request.deal} />
          )}
          {request?.status === 'no_deal' && (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 mb-6 text-sm text-slate-300">
              No shop could meet your constraints this time. Try relaxing the budget or deadline.
            </div>
          )}
          {stalled && !done && (
            <div className="bg-slate-900 border border-amber-400/30 rounded-xl p-3 mb-6 text-xs text-slate-400">
              ⏳ The agents are queuing on free-tier capacity — negotiations are still running and offers will appear here. Feel free to wait or start a new request.
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(shops).map(([shopId, s]) => (
              <ShopCard key={shopId} shop={s} winnerId={request?.deal?.shopId} />
            ))}
          </div>

          <div className="text-center mt-8">
            <button
              onClick={() => {
                setRequestId(null)
                setText('')
                setEvents([])
                setRequest(null)
                setNeed(null)
                window.history.replaceState(null, '', window.location.pathname)
              }}
              className="text-sm text-slate-400 hover:text-amber-400"
            >
              ← New request
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function WinnerBanner({ deal }) {
  const readyBy = new Date(Date.now() + (deal.etaHours || 2) * 3600e3)
  const readyStr = readyBy.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return (
    <div className="relative winner-shimmer border border-amber-400/50 rounded-2xl p-5 mb-6 animate-fade-up shadow-xl shadow-amber-500/10 overflow-hidden">
      <Confetti />
      <div className="flex items-center justify-between mb-2">
        <p className="text-amber-300 text-xs font-semibold uppercase tracking-wider">🏆 Deal closed — order confirmed</p>
        {deal.orderId && (
          <span className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300">
            {deal.orderId}
          </span>
        )}
      </div>
      <p className="text-lg font-semibold">
        {deal.itemName} from {deal.shopName} — ₹{deal.price}
      </p>
      {deal.savings > 0 && (
        <p className="text-sm text-emerald-300 mt-1">
          💰 Opening quote ₹{deal.openingPrice} → your agent closed at ₹{deal.price} —{' '}
          <span className="font-bold">you saved ₹{deal.savings}</span> without saying a word.
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
        <TicketField label="Fulfillment" value={deal.fulfillment === 'delivery' ? '🚚 Shop delivers to you' : '🏬 Pickup at shop'} />
        <TicketField label="Ready by" value={`~${readyStr} (${deal.etaHours}h)`} />
        <TicketField label="Location" value={deal.shopArea || '—'} />
        <TicketField label="Payment" value={deal.payment || 'Pay at handover'} />
      </div>
      {deal.fulfillment === 'delivery' ? (
        <p className="text-xs text-slate-400 mt-3">
          📍 Your exact delivery address is shared only with {deal.shopName} after confirmation.
        </p>
      ) : (
        deal.shopAddress && (
          <p className="text-xs text-slate-400 mt-3">
            📍 {deal.shopAddress} ·{' '}
            <a
              href={`https://www.google.com/maps/search/${encodeURIComponent(deal.shopName + ' ' + deal.shopAddress)}`}
              target="_blank"
              rel="noreferrer"
              className="text-amber-300 underline hover:text-amber-200"
            >
              Open in Maps
            </a>
          </p>
        )
      )}
      {deal.summary && <p className="text-sm text-slate-300 mt-3">{deal.summary}</p>}
    </div>
  )
}

function TicketField({ label, value }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
      <p className="text-slate-500 uppercase tracking-wider text-[9px]">{label}</p>
      <p className="text-slate-200 mt-0.5">{value}</p>
    </div>
  )
}

const CONFETTI_COLORS = ['#fbbf24', '#f97316', '#34d399', '#818cf8', '#f472b6']
function Confetti() {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {Array.from({ length: 28 }).map((_, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${(i * 37) % 100}%`,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${(i % 10) * 0.12}s`,
            animationDuration: `${1.6 + (i % 5) * 0.3}s`,
          }}
        />
      ))}
    </div>
  )
}

function groupByShop(events) {
  const map = {}
  for (const e of events) {
    if (!map[e.shopId]) map[e.shopId] = { name: e.shopName, events: [] }
    map[e.shopId].events.push(e)
  }
  return map
}
