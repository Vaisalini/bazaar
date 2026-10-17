import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { parseIntent } from './intent.js';
import { runNegotiations, pickBestDeal } from './negotiation.js';
import { generateJson, generateText } from './gemini.js';
import { db, getShopsByCategory, getAllShops, createRequest, logEvent, finishRequest, FieldValue } from './firestore.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// Buyer flow: one sentence in -> parallel negotiations -> best deal
app.post('/api/request', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

    const need = await parseIntent(text);
    let shops = await getShopsByCategory(need.category);
    if (!shops.length) shops = await getAllShops();
    shops = shops.slice(0, 8); // cap parallel negotiations per request

    const requestId = await createRequest(text, need);
    res.json({ requestId, need, shopCount: shops.length }); // respond early; UI streams events from Firestore

    const outcomes = await runNegotiations(requestId, need, shops);
    const deal = pickBestDeal(outcomes);

    let summary = null;
    if (deal) {
      summary = await generateText({
        system: 'You summarize a completed agent-to-agent negotiation for the customer in 2-3 friendly sentences. Mention why this deal won.',
        prompt: `Customer asked: "${text}". Winning deal: ${JSON.stringify(deal)}. Other outcomes: ${JSON.stringify(
          outcomes.map((o) => ({ shop: o.shop.name, status: o.status }))
        )}`,
      });
    }
    await finishRequest(requestId, deal ? { ...deal, summary } : null);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  }
});

// Shopkeeper onboarding: conversational messages -> structured shop profile
const shopProfileSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    category: { type: 'string', enum: ['bakery', 'pharmacy', 'electronics', 'stationery', 'general'] },
    area: { type: 'string' },
    persona: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Selling personality inferred from how the owner talks' },
        flexibility: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['style', 'flexibility'],
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          basePrice: { type: 'number' },
          floorPrice: { type: 'number' },
          leadTimeHours: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'basePrice', 'floorPrice'],
      },
    },
    needsMoreInfo: { type: 'boolean' },
    followUpQuestion: { type: 'string', description: 'Next question to ask the owner, in their language' },
  },
  required: ['needsMoreInfo'],
};

app.post('/api/onboard', async (req, res) => {
  try {
    const { messages } = req.body; // [{role: 'owner'|'agent', text}]
    const profile = await generateJson({
      system:
        'You onboard Indian shopkeepers onto Bazaar by chatting with them in their language (English/Hindi/Hinglish). ' +
        'Extract a structured shop profile from the conversation. Infer sensible floorPrice (about 85% of basePrice) ' +
        'when the owner gives one price. If key info (shop name, at least one product with price) is missing, ' +
        'set needsMoreInfo=true and ask ONE friendly followUpQuestion.',
      prompt: `Conversation so far: ${JSON.stringify(messages)}`,
      schema: shopProfileSchema,
    });

    if (profile.needsMoreInfo) return res.json({ done: false, question: profile.followUpQuestion });

    const ref = await db.collection('shops').add({
      name: profile.name,
      category: profile.category || 'general',
      area: profile.area || 'Andheri, Mumbai',
      persona: profile.persona,
      items: profile.items,
      onboardedVia: 'chat',
      createdAt: FieldValue.serverTimestamp(),
    });
    res.json({ done: true, shopId: ref.id, profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Bazaar orchestrator listening on :${port}`));
