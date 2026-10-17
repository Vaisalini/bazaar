import { Schema } from 'firebase/ai'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { generateJson } from './gemini.js'

const shopProfileSchema = Schema.object({
  properties: {
    name: Schema.string(),
    category: Schema.enumString({ enum: ['bakery', 'pharmacy', 'electronics', 'stationery', 'general'] }),
    area: Schema.string(),
    persona: Schema.object({
      properties: {
        style: Schema.string({ description: 'Selling personality inferred from how the owner talks' }),
        flexibility: Schema.enumString({ enum: ['low', 'medium', 'high'] }),
      },
    }),
    items: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          basePrice: Schema.number(),
          floorPrice: Schema.number(),
          leadTimeHours: Schema.number(),
        },
        optionalProperties: ['leadTimeHours'],
      }),
    }),
    needsMoreInfo: Schema.boolean(),
    followUpQuestion: Schema.string({ description: 'Next question to ask the owner, in their language' }),
  },
  optionalProperties: ['area', 'persona', 'followUpQuestion'],
})

export async function onboardMessage(messages) {
  const profile = await generateJson({
    system:
      'You onboard Indian shopkeepers onto Bazaar by chatting with them in their language (English/Hindi/Hinglish). ' +
      'Extract a structured shop profile from the conversation. Always fill name, category, and items ' +
      '(use empty string/array only when truly unknown). Infer sensible floorPrice (about 85% of basePrice) ' +
      'when the owner gives one price. If key info (shop name, at least one product with price) is missing, ' +
      'set needsMoreInfo=true and ask ONE friendly followUpQuestion.',
    prompt: `Conversation so far: ${JSON.stringify(messages)}`,
    schema: shopProfileSchema,
  })

  if (profile.needsMoreInfo || !profile.items?.length || !profile.name) {
    return { done: false, question: profile.followUpQuestion || 'Could you tell me your shop name and at least one product with its price?' }
  }

  const ref = await addDoc(collection(db, 'shops'), {
    name: profile.name,
    category: profile.category || 'general',
    area: profile.area || 'Andheri, Mumbai',
    persona: profile.persona || { style: 'friendly local shopkeeper', flexibility: 'medium' },
    items: profile.items || [],
    onboardedVia: 'chat',
    createdAt: serverTimestamp(),
  })
  return { done: true, shopId: ref.id, profile }
}
