import { useEffect, useState } from 'react'
import { collection, collectionGroup, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'

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
              <div>
                <p className="font-medium">
                  {a.outcome === 'won' && '🏆 Order won'}
                  {a.outcome === 'lost' && '❌ Lost the deal'}
                  {a.outcome === 'dropout' && '🤷 Couldn\u2019t fulfil'}
                  {a.outcome === 'open' && '⏳ Negotiating…'}
                  {a.itemName && <span className="text-slate-300"> — {a.itemName}</span>}
                  {a.price > 0 && <span className="text-amber-300"> · ₹{a.price}</span>}
                </p>
                {a.lastMessage && <p className="text-xs text-slate-400 mt-1">"{a.lastMessage}"</p>}
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

function Insights({ activity }) {
  const won = activity.filter((a) => a.outcome === 'won')
  const lost = activity.filter((a) => a.outcome === 'lost').length
  const missed = activity.filter((a) => a.outcome === 'dropout').length
  const revenue = won.reduce((s, a) => s + (a.price || 0), 0)
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
      {missed > 0 && (
        <span className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-full px-3 py-1.5">
          💡 {missed} request{missed > 1 ? 's' : ''} you couldn't serve — nearby demand you're missing
        </span>
      )}
    </div>
  )
}

function summarize(reqId, events) {
  // events arrive newest-first
  const types = events.map((e) => e.type)
  const offer = events.find((e) => e.type === 'offer')
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
    itemName: offer?.itemName || '',
    price: offer?.price || 0,
    rounds: events.length,
    lastMessage: events[0]?.message || '',
  }
}
