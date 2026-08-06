import { ArrowLeft, Sparkles } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from "motion/react"
import { serverUrl } from '../App'

const PHASES = [
  { label: "Analyzing your idea…", icon: "🔍" },
  { label: "Designing layout & structure…", icon: "📐" },
  { label: "Writing HTML & CSS…", icon: "✍️" },
  { label: "Adding animations & interactions…", icon: "✨" },
  { label: "Finalizing quality checks…", icon: "🚀" },
];

function Generate() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState("")
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [error, setError] = useState("")
  const [streamedChars, setStreamedChars] = useState(0)
  const abortRef = useRef(null)

  const handleGenerateWebsite = async () => {
    if (!prompt.trim() || loading) return
    setLoading(true)
    setError("")
    setProgress(0)
    setPhaseIndex(0)
    setStreamedChars(0)

    try {
      const controller = new AbortController()
      abortRef.current = controller

      const res = await fetch(`${serverUrl}/api/website/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.message || "Request failed")
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() // keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue

          let payload
          try {
            payload = JSON.parse(trimmed.slice(5).trim())
          } catch {
            continue // genuinely malformed SSE line — skip
          }

          if (payload.type === "chunk") {
            setStreamedChars((prev) => {
              const next = prev + (payload.content?.length || 0)
              const pct = Math.min(90, Math.floor((next / 8000) * 90))
              setProgress(pct)
              setPhaseIndex(Math.min(PHASES.length - 1, Math.floor((pct / 90) * (PHASES.length - 1))))
              return next
            })
          }

          if (payload.type === "done") {
            setProgress(100)
            setLoading(false)
            navigate(`/editor/${payload.websiteId}`)
            return
          }

          if (payload.type === "error") {
            // Error from server — surface it to the user
            throw new Error(payload.message)
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return
      setLoading(false)
      setError(err.message || "Something went wrong. Please try again.")
    }
  }

  // Cancel on unmount
  useEffect(() => () => abortRef.current?.abort(), [])

  const canGenerate = prompt.trim() && !loading

  return (
    <div className='min-h-screen bg-[#050505] text-white' style={{ backgroundImage: "radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.04) 0%, transparent 60%)" }}>
      {/* Navbar */}
      <div className='sticky top-0 z-40 backdrop-blur-xl bg-black/60 border-b border-white/8'>
        <div className='max-w-7xl mx-auto px-6 h-16 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <button
              className='p-2 rounded-lg hover:bg-white/8 transition-colors'
              onClick={() => navigate("/")}
            >
              <ArrowLeft size={16} />
            </button>
            <span className='text-base font-semibold tracking-tight'>
              Genweb<span className='text-zinc-500'>.ai</span>
            </span>
          </div>

        </div>
      </div>

      <div className='max-w-3xl mx-auto px-6 py-20'>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <div className='inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-zinc-400 mb-6'>
            <Sparkles size={12} className='text-white' />
            AI Website Builder
          </div>
          <h1 className='text-4xl md:text-5xl font-bold mb-4 leading-tight tracking-tight'>
            Build your website
            <span className='block text-zinc-500'>in seconds, not minutes</span>
          </h1>
          <p className='text-zinc-500 text-sm max-w-lg mx-auto leading-relaxed'>
            Describe your website and watch it build itself in real time.
          </p>
        </motion.div>

        {/* Prompt input */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className='mb-6'
        >
          <textarea
            onChange={(e) => setPrompt(e.target.value)}
            value={prompt}
            placeholder='e.g. "A modern SaaS landing page for a project management tool with dark theme, pricing section, and testimonials"'
            disabled={loading}
            className='w-full h-44 p-5 rounded-2xl bg-white/4 border border-white/10 outline-none resize-none text-sm leading-relaxed placeholder-zinc-600 focus:border-white/20 focus:bg-white/6 transition-all disabled:opacity-50'
          />

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className='mt-3 text-sm text-red-400 bg-red-400/8 border border-red-400/20 rounded-xl px-4 py-2.5'
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Generate button */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className='flex justify-center mb-10'
        >
          <motion.button
            whileHover={canGenerate ? { scale: 1.03 } : {}}
            whileTap={canGenerate ? { scale: 0.97 } : {}}
            onClick={handleGenerateWebsite}
            disabled={!canGenerate}
            className={`px-12 py-3.5 rounded-2xl font-semibold text-base transition-all ${
              canGenerate
                ? "bg-white text-black shadow-[0_0_40px_rgba(255,255,255,0.15)] hover:shadow-[0_0_60px_rgba(255,255,255,0.25)]"
                : "bg-white/10 text-zinc-500 cursor-not-allowed"
            }`}
          >
            {loading ? "Generating…" : "Generate Website"}
          </motion.button>
        </motion.div>

        {/* Live streaming progress */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="max-w-lg mx-auto"
            >
              {/* Phase label */}
              <div className='flex justify-between items-center mb-3'>
                <motion.span
                  key={phaseIndex}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className='text-sm text-zinc-300 flex items-center gap-2'
                >
                  <span>{PHASES[phaseIndex].icon}</span>
                  {PHASES[phaseIndex].label}
                </motion.span>
                <span className='text-sm font-mono text-zinc-400'>{progress}%</span>
              </div>

              {/* Progress bar */}
              <div className='h-1.5 w-full bg-white/8 rounded-full overflow-hidden'>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg, #fff 0%, #a1a1aa 100%)" }}
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: "easeOut", duration: 0.4 }}
                />
              </div>

              {/* Live character counter — shows actual streaming activity */}
              <div className='text-center mt-4 text-xs text-zinc-600'>
                {streamedChars > 0
                  ? `${streamedChars.toLocaleString()} characters generated…`
                  : "Connecting to AI…"}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default Generate
