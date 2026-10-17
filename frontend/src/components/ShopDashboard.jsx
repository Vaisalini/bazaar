import { useEffect, useState } from 'react'
import { collection, collectionGroup, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { answerDemand } from '../agents/demand'

// read-only view of a shop agent's negotiations ("Ramesh wakes up to this")
export default function ShopDashboard({ defaultShopId }) {
  const [shops, setShops] = useState([])
  const [shopId, setShopId] = useState(defaultShopId || '')
  const [activity, setActivity] = useState([])

  useEffect(() => {
    getDocs(collection(db, 'shops')).then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, name: d.data().name }))
      list.sort((a, b) => a.name.localeCompare(b.name))
      setShops(list)
      setShopId((cur) => cur || defaultShopId || list[0]?.id || '')
    })
  }, [defaultShopId])

  useEffect(() => {
    if (!shopId) return
    const q = query(
      collectionGroup(db, 'events'),
      where('shopId', '==', shopId),
      orderBy('ts', 'desc'),
      limit(60)
    )
    return onSnapshot(q, (snap) => {
      // group events by negotiation (parent request)
      const byRequest = new Map()
      for (const d of snap.docs) {
        const reqId = d.ref.parent.parent.id
        if (!byRequest.has(reqId)) byRequest.set(reqId, [])
        byRequest.get(reqId).push(d.data())
      }
      const items = [...byRequest.entries()].map(([reqId, events]) => summarize(reqId, events))
      setActivity(items)
    }, (err) => console.warn('activity feed error (index may still be building)', err))
  }, [shopId])

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-bold">Your agent's activity</h3>
          <p className="text-xs text-slate-400">Every negotiation your agent handled — while you ran the shop.</p>
        </div>
        <select
          value={shopId}
          onChange={(e) => setShopId(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400"
        >
          {shops.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {activity.length === 0 ? (
        <p className="text-sm text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          No negotiations yet for this shop — send a matching request from the buyer tab and watch this feed update live.
        </p>
      ) : (
        <>
          <Insights activity={activity} />
          <div className="flex flex-col gap-2">
            {activity.map((a) => (
            <div
              key={a.reqId}
              className={`animate-fade-up rounded-xl border px-4 py-3 text-sm flex items-start justify-between gap-3 ${
                a.outcome === 'won'
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-slate-800 bg-slate-900/60'
              }`}
            >
              <div className="flex-1">
                <p className="font-medium">
                  {a.outcome === 'won' && '🏆 Order won'}
                  {a.outcome === 'lost' && '❌ Lost the deal'}
                  {a.outcome === 'dropout' && '🤷 Couldn\u2019t fulfil'}
                  {a.outcome === 'open' && '⏳ Negotiating…'}
                  {a.itemName && <span className="text-slate-300"> — {a.itemName}</span>}
                  {a.price > 0 && <span className="text-amber-300"> · ₹{a.price}</span>}
                </p>
                {a.lastMessage && <p className="text-xs text-slate-400 mt-1">"{a.lastMessage}"</p>}
                {a.outcome === 'dropout' && a.missedItem && (
                  <AnswerBox shopId={shopId} neededItem={a.missedItem} />
                )}
              </div>
              <span className="text-[10px] text-slate-500 shrink-0">{a.rounds} turn{a.rounds > 1 ? 's' : ''}</span>
            </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// lazy onboarding: the agent asks, the owner answers once, the catalog grows forever
function AnswerBox({ shopId, neededItem }) {
  const [reply, setReply] = useState('')
  const [state, setState] = useState('idle') // idle | working | done
  const [result, setResult] = useState(null)

  async function submit() {
    if (!reply.trim() || state === 'working') return
    setState('working')
    try {
      const res = await answerDemand(shopId, neededItem, reply)
      setResult(res)
      setState('done')
    } catch {
      setState('idle')
    }
  }

  if (state === 'done') {
    return (
      <p className={`text-xs mt-2 ${result?.added ? 'text-emerald-300' : 'text-slate-400'}`}>
        {result?.added ? '✅ ' : ''}{result?.confirmation}
        {result?.added && <span className="text-slate-400"> Your agent can now offer this in future negotiations.</span>}
      </p>
    )
  }

  return (
    <div className="mt-2 bg-slate-950/60 border border-amber-500/20 rounded-lg p-2.5">
      <p className="text-xs text-amber-200 mb-1.5">
        🙋 Your agent asks: can you supply <span className="font-semibold">{neededItem}</span>? Tell it once — it remembers forever.
      </p>
      <div className="flex gap-2">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder='e.g. "haan, I can order it, 1350 rupees, ready next day"'
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-400"
        />
        <button
          onClick={submit}
          disabled={state === 'working'}
          className="text-xs bg-amber-400 text-slate-950 font-semibold px-3 rounded-lg hover:bg-amber-300 disabled:opacity-50 whitespace-nowrap"
        >
          {state === 'working' ? 'Teaching…' : 'Tell your agent'}
        </button>
      </div>
    </div>
  )
}

function Insights({ activity }) {
  const won = activity.filter((a) => a.outcome === 'won')
  const lost = activity.filter((a) => a.outcome === 'lost').length
  const missed = activity.filter((a) => a.outcome === 'dropout')
  const revenue = won.reduce((s, a) => s + (a.price || 0), 0)
  const missedItems = [...new Set(missed.map((a) => a.missedItem).filter(Boolean))].slice(0, 3)
  return (
    <div className="flex flex-wrap gap-2 mb-3 text-xs">
      <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-full px-3 py-1.5">
        🏆 {won.length} won{revenue > 0 && ` · ₹${revenue} earned`}
      </span>
      {lost > 0 && (
        <span className="bg-slate-900 border border-slate-700 text-slate-300 rounded-full px-3 py-1.5">
          ❌ {lost} lost on price/terms
        </span>
      )}
      {missed.length > 0 && (
        <span className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-full px-3 py-1.5">
          💡 {missed.length} request{missed.length > 1 ? 's' : ''} you couldn't serve
          {missedItems.length > 0 && <> — customers wanted: {missedItems.join(', ')}. Consider stocking it!</>}
        </span>
      )}
    </div>
  )
}

function summarize(reqId, events) {
  // events arrive newest-first
  const types = events.map((e) => e.type)
  const offer = events.find((e) => e.type === 'offer')
  const dropout = events.find((e) => e.type === 'dropout')
  const outcome = types.includes('accept')
    ? 'won'
    : types.includes('reject')
      ? 'lost'
      : types.includes('dropout')
        ? 'dropout'
        : 'open'
  return {
    reqId,
    outcome,
    itemName: offer?.itemName || dropout?.neededItem || '',
    missedItem: dropout?.neededItem || '',
    price: offer?.price || 0,
    rounds: events.length,
    lastMessage: events[0]?.message || '',
  }
}
