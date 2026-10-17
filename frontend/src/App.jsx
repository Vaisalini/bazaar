import { useEffect, useState } from 'react'
import BuyerView from './components/BuyerView'
import OnboardChat from './components/OnboardChat'
import { authReady } from './firebase'
import { seedIfEmpty } from './seedShops'

export default function App() {
  const [tab, setTab] = useState('buyer')

  useEffect(() => {
    authReady.then(() => seedIfEmpty()).catch((e) => console.warn('seed check failed', e))
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 bg-mesh relative overflow-x-hidden">
      <div className="orb w-72 h-72 bg-amber-500/10 -top-20 -left-20" />
      <div className="orb w-96 h-96 bg-indigo-500/10 top-40 -right-32" style={{ animationDelay: '-4s' }} />
      <header className="relative border-b border-slate-800/80 backdrop-blur px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center gap-3 sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-950 text-xl font-black shadow-lg shadow-amber-500/20">
            B
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight leading-none">
              Bazaar<span className="text-amber-400">.</span>
            </h1>
            <p className="text-[11px] text-slate-400">The agent-to-agent commerce network for local shops</p>
          </div>
        </div>
        <nav className="flex gap-1 bg-slate-900/80 border border-slate-800 rounded-xl p-1 w-full sm:w-auto justify-center">
          <TabButton active={tab === 'buyer'} onClick={() => setTab('buyer')}>
            🛍️ Shop
          </TabButton>
          <TabButton active={tab === 'shop'} onClick={() => setTab('shop')}>
            🏪 I'm a shopkeeper
          </TabButton>
        </nav>
      </header>
      <main className="relative max-w-6xl mx-auto px-4 py-8">
        {tab === 'buyer' ? <BuyerView /> : <OnboardChat />}
      </main>
      <footer className="relative text-center text-xs text-slate-600 py-6">
        Demo prototype — shops are seeded demo data · Built with Gemini (Firebase AI Logic), Firestore & Firebase
      </footer>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-500/30'
          : 'text-slate-300 hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  )
}
