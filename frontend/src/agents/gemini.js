import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai'
import { app } from '../firebase'

// Firebase AI Logic -> Gemini Developer API (free Spark tier, key managed by Firebase)
const ai = getAI(app, { backend: new GoogleAIBackend() })

// free-tier quotas are per model: rotate to the next model when one is exhausted
// (all of these run without billing on the Gemini Developer API)
const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
let modelIndex = 0

async function withRetryAndFallback(makeCall, tries = 4) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    const modelName = MODELS[modelIndex % MODELS.length]
    try {
      return await makeCall(modelName)
    } catch (err) {
      lastErr = err
      const msg = String(err)
      if (msg.includes('429')) {
        modelIndex++ // quota hit: switch model immediately, retry fast
        await new Promise((r) => setTimeout(r, 2000))
      } else if (msg.includes('500') || msg.includes('503') || msg.includes('fetch')) {
        await new Promise((r) => setTimeout(r, 5000 * (i + 1)))
      } else if (msg.includes('404')) {
        modelIndex++ // model not available on this project: try the next one
      } else {
        throw err
      }
    }
  }
  throw lastErr
}

export async function generateJson({ system, prompt, schema }) {
  return withRetryAndFallback(async (modelName) => {
    const model = getGenerativeModel(ai, {
      model: modelName,
      systemInstruction: system,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.7,
      },
    })
    const res = await model.generateContent(prompt)
    return JSON.parse(res.response.text())
  })
}

export async function generateText({ system, prompt }) {
  return withRetryAndFallback(async (modelName) => {
    const model = getGenerativeModel(ai, { model: modelName, systemInstruction: system })
    const res = await model.generateContent(prompt)
    return res.response.text()
  })
}

// voice notes -> text via Gemini audio understanding (works behind proxies that block browser speech APIs)
export async function transcribeAudio(base64, mimeType) {
  return withRetryAndFallback(async (modelName) => {
    const model = getGenerativeModel(ai, { model: modelName })
    const res = await model.generateContent([
      { inlineData: { data: base64, mimeType } },
      {
        text:
          'Transcribe this audio exactly as spoken. The speaker may mix English, Hindi, or Hinglish. ' +
          'Return ONLY the transcription text, nothing else. If the audio is silent or unintelligible, return an empty string.',
      },
    ])
    return res.response.text().trim()
  })
}
