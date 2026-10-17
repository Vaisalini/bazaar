import { collection, doc, getDocs, limit, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import shops from './data/shops.json'

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

// self-healing demo data: seeds the marketplace if it's ever empty.
// deterministic doc IDs make this idempotent even if run concurrently (React StrictMode).
export async function seedIfEmpty() {
  const snap = await getDocs(query(collection(db, 'shops'), limit(1)))
  if (!snap.empty) return false
  await Promise.allSettled(
    shops.map((shop) =>
      setDoc(doc(db, 'shops', slug(shop.name)), {
        ...shop,
        onboardedVia: 'seed',
        createdAt: serverTimestamp(),
      })
    )
  )
  console.log(`Seeded ${shops.length} demo shops`)
  return true
}
