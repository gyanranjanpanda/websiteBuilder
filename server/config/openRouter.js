/**
 * AI provider with a 3-tier priority chain:
 *   1. DeepSeek  — primary (paid, fastest, best quality)
 *   2. Groq      — fallback when DeepSeek credits exhausted
 *   3. OpenRouter free models — last resort (non-streaming)
 */

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const OPENROUTER_FREE_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "inclusionai/ling-3.0-flash:free",
];

const SYSTEM_PROMPT = "You must return ONLY valid raw JSON. No markdown. No explanation.";

const CREDIT_ERROR_STATUSES = new Set([402, 429]);
const CREDIT_ERROR_PHRASES = ["insufficient_balance", "credits", "quota", "billing"];

function isCreditError(status, body = "") {
  if (CREDIT_ERROR_STATUSES.has(status)) return true;
  const lower = body.toLowerCase();
  return CREDIT_ERROR_PHRASES.some((p) => lower.includes(p));
}

// ---------------------------------------------------------------------------
// Non-streaming: used for simple calls or OpenRouter fallback
// ---------------------------------------------------------------------------

async function callDeepSeek(prompt) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || key === "your_deepseek_api_key_here") throw Object.assign(new Error("DeepSeek not configured"), { skip: true });

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 8000,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    const err = Object.assign(new Error(`DeepSeek ${res.status}: ${body}`), { status: res.status, body });
    throw err;
  }
  return JSON.parse(body).choices[0].message.content;
}

async function callGroq(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key || key === "your_groq_api_key_here") throw Object.assign(new Error("Groq not configured"), { skip: true });

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3-70b-8192",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 8000,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    const err = Object.assign(new Error(`Groq ${res.status}: ${body}`), { status: res.status, body });
    throw err;
  }
  return JSON.parse(body).choices[0].message.content;
}

async function callOpenRouter(prompt) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OpenRouter not configured");

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      models: OPENROUTER_FREE_MODELS,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 8000,
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${body}`);
  return JSON.parse(body).choices[0].message.content;
}

// ---------------------------------------------------------------------------
// Streaming helpers — pipe SSE chunks from provider → Express response
// ---------------------------------------------------------------------------

/**
 * Streams a provider's SSE response, calling onChunk(text) for each delta.
 * Returns the full accumulated text.
 */
async function streamProvider(url, key, model, prompt, onChunk) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 8000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = Object.assign(new Error(`${res.status}: ${body}`), { status: res.status, body });
    throw err;
  }

  let accumulated = "";
  const decoder = new TextDecoder();

  for await (const rawChunk of res.body) {
    const text = decoder.decode(rawChunk, { stream: true });
    const lines = text.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          accumulated += delta;
          if (onChunk) onChunk(delta); // 🔑 send each token as it arrives
        }
      } catch {
        // partial JSON line — skip
      }
    }
  }

  return accumulated;
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Non-streaming: tries DeepSeek → Groq → OpenRouter in order.
 * Used for operations that don't need real-time output.
 */
export const generateResponse = async (prompt) => {
  // 1. DeepSeek
  try {
    const result = await callDeepSeek(prompt);
    console.log("[AI] DeepSeek ✓");
    return result;
  } catch (e) {
    if (!e.skip) {
      const credit = isCreditError(e.status, e.body);
      console.warn(`[AI] DeepSeek failed (${credit ? "credits exhausted" : e.message}) → trying Groq`);
      if (!credit) console.error(e.message);
    }
  }

  // 2. Groq
  try {
    const result = await callGroq(prompt);
    console.log("[AI] Groq ✓");
    return result;
  } catch (e) {
    console.warn("[AI] Groq failed:", e.message, "→ trying OpenRouter");
  }

  // 3. OpenRouter free
  const result = await callOpenRouter(prompt);
  console.log("[AI] OpenRouter ✓");
  return result;
};

/**
 * Streaming: pipes chunks to the Express SSE response.
 * Tries DeepSeek stream → Groq stream → OpenRouter non-stream.
 *
 * The caller must have already set SSE headers on `res`.
 * Returns the full generated text (so the caller can parse JSON from it).
 */
export const generateStreamingResponse = async (prompt, onChunk) => {
  // 1. Try DeepSeek stream
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey && deepseekKey !== "your_deepseek_api_key_here") {
    try {
      const text = await streamProvider(DEEPSEEK_URL, deepseekKey, "deepseek-chat", prompt, onChunk);
      console.log("[AI] DeepSeek stream ✓");
      return text;
    } catch (e) {
      const credit = isCreditError(e.status, e.body);
      console.warn(`[AI] DeepSeek stream failed (${credit ? "credits exhausted" : e.message}) → Groq`);
    }
  }

  // 2. Try Groq stream
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey && groqKey !== "your_groq_api_key_here") {
    try {
      const text = await streamProvider(GROQ_URL, groqKey, "llama3-70b-8192", prompt, onChunk);
      console.log("[AI] Groq stream ✓");
      return text;
    } catch (e) {
      console.warn("[AI] Groq stream failed:", e.message, "→ OpenRouter");
    }
  }

  // 3. OpenRouter non-streaming last resort
  console.log("[AI] OpenRouter fallback (non-streaming)");
  const result = await callOpenRouter(prompt);
  if (onChunk) onChunk(result);
  return result;
};

