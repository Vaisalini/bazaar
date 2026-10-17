import { generateJson } from './gemini.js';

const intentSchema = {
  type: 'object',
  properties: {
    item: { type: 'string', description: 'The product or service the buyer wants' },
    category: {
      type: 'string',
      enum: ['bakery', 'pharmacy', 'electronics', 'stationery', 'general'],
    },
    quantity: { type: 'string' },
    maxPrice: { type: 'number', description: 'Budget ceiling in INR, 0 if unspecified' },
    deadline: { type: 'string', description: 'When the buyer needs it, empty if unspecified' },
    location: { type: 'string' },
    specialRequirements: { type: 'array', items: { type: 'string' } },
  },
  required: ['item', 'category', 'maxPrice'],
};

export async function parseIntent(rawText) {
  return generateJson({
    system:
      'You parse shopping requests from customers in India into structured form. ' +
      'Requests may be in English, Hindi, or Hinglish. Infer the best-fit category. ' +
      'Prices are in INR. Be precise; do not invent requirements the buyer did not state.',
    prompt: `Parse this shopping request: "${rawText}"`,
    schema: intentSchema,
  });
}
