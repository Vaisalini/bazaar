import { Schema } from 'firebase/ai'
import { arrayUnion, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { generateJson } from './gemini.js'

const answerSchema = Schema.object({
  properties: {
    canSupply: Schema.boolean({ description: 'true if the owner says they can stock/make/order this item' }),
    item: Schema.object({
      properties: {
        name: Schema.string(),
        basePrice: Schema.number(),
        floorPrice: Schema.number({ description: 'Lowest acceptable price; infer ~85% of basePrice if not stated' }),
        leadTimeHours: Schema.number({ description: 'Hours until available; infer from phrases like "next day"' }),
      },
      optionalProperties: ['leadTimeHours'],
    }),
    confirmation: Schema.string({ description: 'One friendly sentence back to the owner, in their language' }),
  },
  optionalProperties: ['item'],
})

// lazy onboarding: owner's free-form reply -> permanent catalog item
export async function answerDemand(shopId, neededItem, ownerReply) {
  const parsed = await generateJson({
    system:
      'A customer recently asked this shop for an item it did not have. The owner is now replying ' +
      '(English/Hindi/Hinglish) about whether they can supply it. Extract a catalog entry. ' +
      'Prices are INR. If the owner says no / cannot supply, set canSupply=false.',
    prompt: `Item customers asked for: "${neededItem}"\nOwner's reply: "${ownerReply}"`,
    schema: answerSchema,
  })

  if (!parsed.canSupply || !parsed.item?.name || !parsed.item?.basePrice) {
    return { added: false, confirmation: parsed.confirmation || 'Noted — I won\u2019t offer this item.' }
  }

  const item = {
    name: parsed.item.name,
    basePrice: parsed.item.basePrice,
    floorPrice: parsed.item.floorPrice || Math.round(parsed.item.basePrice * 0.85),
    leadTimeHours: parsed.item.leadTimeHours ?? 24,
    tags: ['learned-from-demand'],
  }
  await updateDoc(doc(db, 'shops', shopId), { items: arrayUnion(item) })
  return { added: true, item, confirmation: parsed.confirmation || `Added ${item.name} at \u20b9${item.basePrice} — I can sell it from now on!` }
}
