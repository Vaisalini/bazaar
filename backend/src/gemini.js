import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL = 'gemini-2.5-flash';

// Generate a JSON response conforming to a schema, with one retry on parse failure.
export async function generateJson({ system, prompt, schema }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature: attempt === 0 ? 0.7 : 0.3,
        },
      });
      return JSON.parse(res.text);
    } catch (err) {
      if (attempt === 1) throw err;
    }
  }
}

export async function generateText({ system, prompt }) {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { systemInstruction: system, temperature: 0.8 },
  });
  return res.text;
}
