import { Schema } from 'firebase/ai'
import {
  addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { generateJson, generateText } from './gemini.js'

const MAX_ROUNDS = 2
const MAX_SHOPS = 4

// ---------- intent parsing ----------

const intentSchema = Schema.object({
  properties: {
    item: Schema.string({ description: 'The product or service the buyer wants' }),
    category: Schema.enumString({ enum: ['bakery', 'pharmacy', 'electronics', 'stationery', 'general'] }),
    quantity: Schema.string(),
    maxPrice: Schema.number({ description: 'Budget ceiling in INR, 0 if unspecified' }),
    deadline: Schema.string({ description: 'When the buyer needs it, empty if unspecified' }),
    location: Schema.string(),
  },
  optionalProperties: ['quantity', 'deadline', 'location'],
})

export async function parseIntent(rawText) {
  return generateJson({
    system:
      'You parse shopping requests from customers in India into structured form. ' +
      'Requests may be in English, Hindi, or Hinglish. Infer the best-fit category. ' +
      'Prices are in INR. Do not invent requirements the buyer did not state.',
    prompt: `Parse this shopping request: "${rawText}"`,
    schema: intentSchema,
  })
}

// ---------- batched negotiation (one Gemini call plays all shop agents per round) ----------

const shopsTurnSchema = Schema.object({
  properties: {
    turns: Schema.array({
      items: Schema.object({
        properties: {
          shopId: Schema.string(),
          action: Schema.enumString({ enum: ['offer', 'dropout'] }),
          itemName: Schema.string(),
          price: Schema.number(),
          etaHours: Schema.number(),
          fulfillment: Schema.enumString({ enum: ['pickup', 'delivery'] }),
          message: Schema.string({ description: 'Short in-character message from this shop agent' }),
        },
        optionalProperties: ['itemName', 'price', 'etaHours', 'fulfillment'],
      }),
    }),
  },
})

const buyerTurnSchema = Schema.object({
  properties: {
    turns: Schema.array({
      items: Schema.object({
        properties: {
          shopId: Schema.string(),
          action: Schema.enumString({ enum: ['accept', 'counter', 'reject'] }),
          counterPrice: Schema.number(),
          message: Schema.string({ description: 'Short message from the buyer agent to this shop' }),
        },
        optionalProperties: ['counterPrice'],
      }),
    }),
  },
})

function findFloor(shop, itemName = '') {
  const lower = (itemName || '').toLowerCase()
  const item = shop.items.find(
    (i) => lower.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(lower)
  )
  if (item) return item.floorPrice
  return Math.min(...shop.items.map((i) => i.floorPrice))
}

// lightweight locality match: token overlap between buyer location and shop area
function areaMatches(location = '', area = '') {
  const tokens = location.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3)
  const areaLower = area.toLowerCase()
  return tokens.some((t) => areaLower.includes(t))
}

async function logEvent(requestId, event) {
  await addDoc(collection(db, 'requests', requestId, 'events'), { ...event, ts: serverTimestamp() })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function shopBrief(shop, state) {
  return {
    shopId: shop.id,
    name: shop.name,
    area: shop.area,
    personality: shop.persona.style,
    flexibility: shop.persona.flexibility,
    inventory: shop.items.map(({ name, basePrice, leadTimeHours, tags }) => ({ name, basePrice, leadTimeHours, tags })),
    conversationSoFar: state.transcript,
  }
}

async function runNegotiation(requestId, need, shops) {
  const states = Object.fromEntries(
    shops.map((s) => [s.id, { shop: s, status: 'live', transcript: [], lastOffer: null }])
  )
  const live = () => Object.values(states).filter((s) => s.status === 'live')

  for (let round = 1; round <= MAX_ROUNDS && live().length; round++) {
    // --- all shop agents respond in one call ---
    const shopsTurn = await generateJson({
      system:
        'You simulate the AI sales agents of several Indian local shops, each with its own personality and inventory. ' +
        "For EACH shop, produce its next negotiation move toward the buyer. Stay strictly within each shop's own inventory. " +
        'Start near base price; concede gradually if countered, according to flexibility. ' +
        'A shop that cannot fulfil the request (wrong item, impossible deadline) must choose action "dropout". ' +
        'Each offer must state fulfillment: "delivery" if the shop would deliver to the buyer, otherwise "pickup". ' +
        'Keep fulfillment consistent between rounds and consistent with what your message says. ' +
        'Delivery may justify a slightly higher price; pickup can be cheaper. ' +
        'Messages: one or two short sentences, in character, may use light Hinglish.',
      prompt:
        `Buyer need: ${JSON.stringify(need)}\n` +
        `Round ${round} of ${MAX_ROUNDS}.\n` +
        `Shops: ${JSON.stringify(live().map((s) => shopBrief(s.shop, s)))}\n` +
        `Return one turn per shop (use the exact shopId values).`,
      schema: shopsTurnSchema,
    })

    for (const turn of shopsTurn.turns || []) {
      const st = states[turn.shopId]
      if (!st || st.status !== 'live') continue
      const shop = st.shop
      if (turn.action === 'dropout') {
        st.status = 'dropout'
        st.transcript.push({ actor: 'shop', action: 'dropout', message: turn.message })
        await logEvent(requestId, {
          shopId: shop.id, shopName: shop.name, shopArea: shop.area, near: !!shop.near,
          round, actor: 'shop', type: 'dropout', message: turn.message,
          neededItem: need.item || '',
        })
      } else {
        const floor = findFloor(shop, turn.itemName)
        const price = Math.max(Math.round(turn.price || floor), floor) // price floor enforced in code
        st.lastOffer = {
          itemName: turn.itemName || need.item,
          price,
          etaHours: turn.etaHours ?? 2,
          fulfillment: turn.fulfillment || 'pickup',
        }
        st.transcript.push({ actor: 'shop', ...st.lastOffer, message: turn.message })
        await logEvent(requestId, {
          shopId: shop.id, shopName: shop.name, shopArea: shop.area, near: !!shop.near,
          round, actor: 'shop', type: 'offer',
          price, itemName: st.lastOffer.itemName, etaHours: st.lastOffer.etaHours,
          fulfillment: st.lastOffer.fulfillment, message: turn.message,
        })
      }
      await sleep(400) // stagger events so the UI streams naturally
    }

    if (!live().length) break

    // --- buyer agent reacts to all offers in one call ---
    const buyerTurn = await generateJson({
      system:
        'You are a buyer agent negotiating with several shop agents at once on behalf of your customer. ' +
        "React to each shop's current offer: accept a good offer within budget, counter when there is room, " +
        'reject hopeless ones. You may accept at most ONE shop per round - the best one. Be polite but firm. Short messages.',
      prompt:
        `Customer need: ${JSON.stringify(need)}\n` +
        `Round ${round} of ${MAX_ROUNDS}.${round === MAX_ROUNDS ? ' FINAL round: accept or reject only.' : ''}\n` +
        `Current offers: ${JSON.stringify(
          live().map((s) => ({ shopId: s.shop.id, shopName: s.shop.name, offer: s.lastOffer, history: s.transcript }))
        )}\n` +
        `Return one reaction per shop (use the exact shopId values).`,
      schema: buyerTurnSchema,
    })

    for (const turn of buyerTurn.turns || []) {
      const st = states[turn.shopId]
      if (!st || st.status !== 'live') continue
      let action = turn.action
      // hard budget guard in code
      if (action === 'accept' && need.maxPrice > 0 && st.lastOffer.price > need.maxPrice) {
        action = round === MAX_ROUNDS ? 'reject' : 'counter'
      }
      st.transcript.push({ actor: 'buyer', action, counterPrice: turn.counterPrice, message: turn.message })
      await logEvent(requestId, {
        shopId: st.shop.id, shopName: st.shop.name, shopArea: st.shop.area, near: !!st.shop.near,
        round, actor: 'buyer',
        type: action, counterPrice: turn.counterPrice || null, message: turn.message,
      })
      if (action === 'accept') st.status = 'deal'
      if (action === 'reject') st.status = 'no_deal'
      await sleep(400)
    }
  }

  for (const st of Object.values(states)) if (st.status === 'live') st.status = 'no_deal'
  return Object.values(states)
}

function pickBestDeal(outcomes) {
  const deals = outcomes.filter((o) => o.status === 'deal')
  if (!deals.length) return null
  deals.sort((a, b) => a.lastOffer.price - b.lastOffer.price)
  const best = deals[0]
  const openingPrice = best.transcript.find((t) => t.actor === 'shop' && t.price)?.price || best.lastOffer.price
  return {
    orderId: 'BZR-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
    shopId: best.shop.id,
    shopName: best.shop.name,
    shopArea: best.shop.area,
    shopAddress: best.shop.address || best.shop.area,
    itemName: best.lastOffer.itemName,
    price: best.lastOffer.price,
    openingPrice,
    savings: Math.max(0, openingPrice - best.lastOffer.price),
    etaHours: best.lastOffer.etaHours,
    fulfillment: best.lastOffer.fulfillment || 'pickup',
    payment: 'Pay at handover — cash or shop UPI QR',
    competingDeals: deals.length - 1,
  }
}

// ---------- the full flow ----------

export async function runRequest(rawText) {
  const need = await parseIntent(rawText)

  let snap = await getDocs(query(collection(db, 'shops'), where('category', '==', need.category)))
  if (snap.empty) snap = await getDocs(collection(db, 'shops'))
  // rank location matches first, then take the top slice (skip shops with no usable catalog)
  const shops = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => s.items?.length)
    .map((s) => ({ ...s, near: areaMatches(need.location, s.area) }))
    .sort((a, b) => (b.near === a.near ? 0 : b.near ? 1 : -1))
    .slice(0, MAX_SHOPS)

  const reqRef = await addDoc(collection(db, 'requests'), {
    rawText, parsed: need, status: 'negotiating', createdAt: serverTimestamp(),
  })

  // fire-and-forget so the UI can stream events immediately
  ;(async () => {
    try {
      const outcomes = await runNegotiation(reqRef.id, need, shops)
      const deal = pickBestDeal(outcomes)

      let summary = null
      if (deal) {
        summary = await generateText({
          system:
            'You summarize a completed agent-to-agent negotiation for the customer in 2-3 friendly sentences. Mention why this deal won.',
          prompt: `Customer asked: "${rawText}". Winning deal: ${JSON.stringify(deal)}. Other outcomes: ${JSON.stringify(
            outcomes.map((o) => ({ shop: o.shop.name, status: o.status }))
          )}`,
        })
      }
      await updateDoc(doc(db, 'requests', reqRef.id), {
        status: deal ? 'completed' : 'no_deal',
        deal: deal ? { ...deal, summary } : null,
        completedAt: serverTimestamp(),
      })
    } catch (err) {
      console.error('negotiation flow failed', err)
      await updateDoc(doc(db, 'requests', reqRef.id), { status: 'no_deal', deal: null })
    }
  })()

  return { requestId: reqRef.id, need, shopCount: shops.length }
}
