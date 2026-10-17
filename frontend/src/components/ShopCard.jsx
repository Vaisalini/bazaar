export default function ShopCard({ shop, winnerId }) {
  const last = shop.events[shop.events.length - 1]
  const shopId = last?.shopId
  const isWinner = winnerId && shopId === winnerId
  const status = deriveStatus(shop.events, isWinner)
  const initial = (shop.name || '?').charAt(0).toUpperCase()

  return (
    <div
      className={`rounded-2xl border p-4 flex flex-col gap-2.5 animate-fade-up transition-all ${
        isWinner
          ? 'border-amber-400 bg-amber-400/10 shadow-lg shadow-amber-500/20'
          : status.key === 'out'
            ? 'border-slate-800 bg-slate-900/40 opacity-50'
            : status.key === 'live'
              ? 'border-amber-400/40 bg-slate-900/90 card-live'
              : 'border-slate-700 bg-slate-900/90'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
              isWinner ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {initial}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{shop.name}</h3>
            {last?.shopArea && (
              <p className="text-[10px] text-slate-500 truncate">
                📍 {last.shopArea}
                {last.near && <span className="ml-1 text-emerald-400">· near you</span>}
              </p>
            )}
          </div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${status.cls}`}>{status.label}</span>
      </div>

      <div className="flex flex-col gap-1.5 text-xs max-h-52 overflow-y-auto pr-1">
        {shop.events.map((e) => (
          <Bubble key={e.id} e={e} />
        ))}
        {status.key === 'live' && (
          <div className="flex justify-start">
            <div className="bg-slate-800/80 rounded-lg px-2.5 py-1.5 text-amber-300">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Bubble({ e }) {
  const isShop = e.actor === 'shop'
  return (
    <div className={`flex ${isShop ? 'justify-start' : 'justify-end'} animate-fade-up`}>
      <div
        className={`max-w-[85%] rounded-lg px-2.5 py-1.5 ${
          isShop ? 'bg-slate-800 text-slate-200' : 'bg-indigo-500/20 text-indigo-200'
        }`}
      >
        {e.type === 'offer' && (
          <p className="font-semibold text-amber-300">
            ₹{e.price}
            {e.etaHours ? ` · ${e.etaHours}h` : ''}
            {e.fulfillment ? (e.fulfillment === 'delivery' ? ' · 🚚' : ' · 🏬') : ''}
          </p>
        )}
        {e.type === 'counter' && e.counterPrice && (
          <p className="font-semibold text-indigo-300">counter: ₹{e.counterPrice}</p>
        )}
        <p>{e.message}</p>
      </div>
    </div>
  )
}

function deriveStatus(events, isWinner) {
  if (isWinner) return { key: 'win', label: 'DEAL ✓', cls: 'bg-amber-400 text-slate-950 font-bold' }
  const types = events.map((e) => e.type)
  if (types.includes('dropout')) return { key: 'out', label: 'dropped out', cls: 'bg-slate-700 text-slate-300' }
  if (types.includes('reject')) return { key: 'out', label: 'no deal', cls: 'bg-slate-700 text-slate-300' }
  if (types.includes('accept')) return { key: 'deal', label: 'deal agreed', cls: 'bg-emerald-500/20 text-emerald-300' }
  return { key: 'live', label: 'negotiating…', cls: 'bg-amber-400/10 text-amber-300' }
}
