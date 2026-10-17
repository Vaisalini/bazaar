import { generateJson } from './gemini.js';
import { logEvent } from './firestore.js';

const MAX_ROUNDS = 3;

const shopTurnSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['offer', 'dropout'] },
    itemName: { type: 'string' },
    price: { type: 'number' },
    etaHours: { type: 'number' },
    message: { type: 'string', description: 'Short in-character message to the buyer agent' },
  },
  required: ['action', 'message'],
};

const buyerTurnSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['accept', 'counter', 'reject'] },
    counterPrice: { type: 'number' },
    message: { type: 'string', description: 'Short message to the shop agent' },
  },
  required: ['action', 'message'],
};

function findFloor(shop, itemName = '') {
  const lower = itemName.toLowerCase();
  const item = shop.items.find(
    (i) => lower.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(lower)
  );
  if (item) return item.floorPrice;
  return Math.min(...shop.items.map((i) => i.floorPrice));
}

function shopSystemPrompt(shop) {
  return (
    `You are the AI sales agent for "${shop.name}", a ${shop.category} shop in ${shop.area}. ` +
    `Personality: ${shop.persona.style}. Negotiation flexibility: ${shop.persona.flexibility}. ` +
    `Your inventory (with base prices in INR): ${JSON.stringify(
      shop.items.map(({ name, basePrice, leadTimeHours, tags }) => ({ name, basePrice, leadTimeHours, tags }))
    )}. ` +
    `Rules: only offer items you actually stock. Start near base price; concede gradually if pushed. ` +
    `If you cannot fulfil the request (wrong item, impossible deadline), choose action "dropout". ` +
    `Keep messages to one or two short sentences, in character.`
  );
}

const buyerSystem =
  'You are a buyer agent negotiating with local shop agents on behalf of your customer. ' +
  'Be polite but firm. Push for a better price or faster delivery when reasonable. ' +
  'Accept good offers within budget instead of over-negotiating. Keep messages short.';

async function negotiateWithShop(requestId, need, shop) {
  const transcript = [];
  let lastOffer = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // --- shop agent turn ---
    const shopTurn = await generateJson({
      system: shopSystemPrompt(shop),
      prompt:
        `Buyer need: ${JSON.stringify(need)}\n` +
        `Conversation so far: ${JSON.stringify(transcript)}\n` +
        `Round ${round} of ${MAX_ROUNDS}. Respond with your next move.`,
      schema: shopTurnSchema,
    });

    if (shopTurn.action === 'dropout') {
      await logEvent(requestId, {
        shopId: shop.id, shopName: shop.name, round, actor: 'shop',
        type: 'dropout', message: shopTurn.message,
      });
      return { shop, status: 'dropout', transcript };
    }

    // enforce the owner's price floor in code, not prompts
    const floor = findFloor(shop, shopTurn.itemName);
    const price = Math.max(Math.round(shopTurn.price || floor), floor);
    lastOffer = { itemName: shopTurn.itemName, price, etaHours: shopTurn.etaHours ?? 2 };
    transcript.push({ actor: 'shop', ...lastOffer, message: shopTurn.message });

    await logEvent(requestId, {
      shopId: shop.id, shopName: shop.name, round, actor: 'shop',
      type: 'offer', price, itemName: lastOffer.itemName,
      etaHours: lastOffer.etaHours, message: shopTurn.message,
    });

    // --- buyer agent turn ---
    const buyerTurn = await generateJson({
      system: buyerSystem,
      prompt:
        `Customer need: ${JSON.stringify(need)}\n` +
        `Current offer from ${shop.name}: ${JSON.stringify(lastOffer)}\n` +
        `Conversation so far: ${JSON.stringify(transcript)}\n` +
        `Round ${round} of ${MAX_ROUNDS}. Final round means accept or reject.` +
        (round === MAX_ROUNDS ? ' This IS the final round.' : ''),
      schema: buyerTurnSchema,
    });

    // hard budget guard: never accept above the customer's stated budget
    let action = buyerTurn.action;
    if (action === 'accept' && need.maxPrice > 0 && lastOffer.price > need.maxPrice) {
      action = round === MAX_ROUNDS ? 'reject' : 'counter';
    }

    transcript.push({ actor: 'buyer', action, counterPrice: buyerTurn.counterPrice, message: buyerTurn.message });
    await logEvent(requestId, {
      shopId: shop.id, shopName: shop.name, round, actor: 'buyer',
      type: action, counterPrice: buyerTurn.counterPrice || null, message: buyerTurn.message,
    });

    if (action === 'accept') return { shop, status: 'deal', finalOffer: lastOffer, transcript };
    if (action === 'reject') return { shop, status: 'no_deal', transcript };
  }
  return { shop, status: 'no_deal', transcript };
}

export async function runNegotiations(requestId, need, shops) {
  const results = await Promise.allSettled(
    shops.map((shop) => negotiateWithShop(requestId, need, shop))
  );
  return results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
}

export function pickBestDeal(outcomes) {
  const deals = outcomes.filter((o) => o.status === 'deal');
  if (!deals.length) return null;
  deals.sort((a, b) => a.finalOffer.price - b.finalOffer.price);
  const best = deals[0];
  return {
    shopId: best.shop.id,
    shopName: best.shop.name,
    itemName: best.finalOffer.itemName,
    price: best.finalOffer.price,
    etaHours: best.finalOffer.etaHours,
    competingDeals: deals.length - 1,
  };
}
