import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const PORT = process.env.PORT || 8787

if (!GROQ_API_KEY) {
  console.warn('[groq-relay] GROQ_API_KEY is not set — /api/chat will return errors until it is.')
}

const app = express()
app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(GROQ_API_KEY) })
})

app.post('/api/chat', async (req, res) => {
  const { systemPrompt, message, history } = req.body ?? {}

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' })
  }

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server' })
  }

  try {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.6,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
          ...(Array.isArray(history) ? history : []),
          { role: 'user', content: message },
        ],
      }),
    })

    if (!groqResponse.ok) {
      const text = await groqResponse.text()
      console.error('[groq-relay] Groq API error', groqResponse.status, text)
      return res.status(502).json({ error: 'Groq API request failed' })
    }

    const data = await groqResponse.json()
    const reply = data.choices?.[0]?.message?.content?.trim() ?? ''
    res.json({ reply })
  } catch (err) {
    console.error('[groq-relay] Unexpected error', err)
    res.status(500).json({ error: 'Unexpected server error' })
  }
})

app.listen(PORT, () => {
  console.log(`[groq-relay] listening on http://localhost:${PORT}`)
})
