import { generateResponse, generateStreamingResponse } from "../config/openRouter.js";
import User from "../models/user.model.js";
import Website from "../models/website.model.js";
import extractJson from "../utils/extractJson.js";

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ---------------------------------------------------------------------------
// Master prompt — concise but authoritative
// ---------------------------------------------------------------------------

const masterPrompt = `
YOU ARE A PRINCIPAL FRONTEND ARCHITECT SPECIALIZED IN RESPONSIVE DESIGN SYSTEMS.
BUILD A HIGH-END, PRODUCTION-GRADE SINGLE-PAGE APPLICATION USING ONLY HTML, CSS, AND JAVASCRIPT.

USER REQUIREMENT:
{USER_PROMPT}

━━━ QUALITY BAR (NON-NEGOTIABLE) ━━━
- Premium modern UI (2026–2027 aesthetic)
- Professional typography & spacing
- Clean visual hierarchy
- Business-ready real content (NO lorem ipsum)
- Smooth transitions & micro-animations
- SPA multi-page experience (Home / About / Services / Contact)
- Fully responsive: mobile-first, works on 320px–1920px screens

━━━ RESPONSIVE REQUIREMENTS ━━━
- CSS Grid / Flexbox with relative units (%, rem, vw, vh)
- Media queries for mobile (<768px), tablet (768–1024px), desktop (>1024px)
- Hamburger nav on mobile
- No horizontal scrolling on any screen size
- Images: max-width:100%, height:auto, never overflow containers

━━━ IMAGES ━━━
Use high-quality Unsplash images with real photo IDs, e.g.:
https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80

━━━ TECHNICAL RULES ━━━
- ONE .html file
- ONE <style> tag — ONE <script> tag
- NO external CSS / JS / fonts — system fonts only
- iframe srcdoc compatible
- SPA navigation via JavaScript (no page reloads)
- All buttons functional — no dead UI
- If .page { display:none } → .page.active { display:block } REQUIRED

━━━ OUTPUT ━━━
Return RAW JSON only — no markdown, no explanation:
{"message":"Short professional confirmation","code":"<FULL VALID HTML DOCUMENT>"}
`.trim();

// ---------------------------------------------------------------------------
// Generate website (streaming SSE)
// ---------------------------------------------------------------------------

export const generateWebsite = async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ message: "prompt is required" });

  const user = await User.findById(req.user._id);
  if (!user) return res.status(400).json({ message: "user not found" });
  if (user.credits < 50) return res.status(400).json({ message: "not enough credits to generate a website" });

  // Switch to SSE mode
  sseHeaders(res);

  try {
    const finalPrompt = masterPrompt.replace("{USER_PROMPT}", prompt);

    sseWrite(res, { type: "status", message: "Generating your website…" });

    // Stream from AI — accumulate full text
    let rawText = await generateStreamingResponse(finalPrompt, (chunk) => {
      sseWrite(res, { type: "chunk", content: chunk });
    });

    // Parse the JSON response
    let parsed = await extractJson(rawText);

    // Single retry if JSON parse failed (not a double-call loop)
    if (!parsed) {
      sseWrite(res, { type: "status", message: "Refining output…" });
      rawText = await generateResponse(finalPrompt + "\n\nRETURN ONLY RAW JSON. No markdown.");
      parsed = await extractJson(rawText);
    }

    if (!parsed?.code) {
      console.error("[generate] AI returned invalid JSON:", rawText?.slice(0, 200));
      sseWrite(res, { type: "error", message: "AI returned an invalid response. Please try again." });
      return res.end();
    }

    // Save to DB
    const website = await Website.create({
      user: user._id,
      title: prompt.slice(0, 60),
      latestCode: parsed.code,
      conversation: [
        { role: "user", content: prompt },
        { role: "ai", content: parsed.message },
      ],
    });

    user.credits -= 50;
    await user.save();

    sseWrite(res, {
      type: "done",
      websiteId: website._id,
      message: parsed.message,
      remainingCredits: user.credits,
    });

    res.end();
  } catch (error) {
    console.error("[generate] error:", error);
    sseWrite(res, { type: "error", message: `Generation failed: ${error.message}` });
    res.end();
  }
};

// ---------------------------------------------------------------------------
// Update / change existing website (streaming SSE)
// ---------------------------------------------------------------------------

export const changes = async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ message: "prompt is required" });

  const [website, user] = await Promise.all([
    Website.findOne({ _id: req.params.id, user: req.user._id }),
    User.findById(req.user._id),
  ]);

  if (!website) return res.status(400).json({ message: "website not found" });
  if (!user) return res.status(400).json({ message: "user not found" });
  if (user.credits < 25) return res.status(400).json({ message: "not enough credits to update this website" });

  // Switch to SSE mode
  sseHeaders(res);

  try {
    // Send only the current HTML, not the entire conversation history
    const updatePrompt = `
UPDATE THIS HTML WEBSITE BASED ON THE USER REQUEST.
Keep all existing sections. Only apply the requested change.

CURRENT CODE:
${website.latestCode}

USER REQUEST:
${prompt}

Return RAW JSON only:
{"message":"Short confirmation of what was changed","code":"<UPDATED FULL HTML DOCUMENT>"}
`.trim();

    sseWrite(res, { type: "status", message: "Applying your changes…" });

    let rawText = await generateStreamingResponse(updatePrompt, (chunk) => {
      sseWrite(res, { type: "chunk", content: chunk });
    });

    let parsed = await extractJson(rawText);

    // Single retry
    if (!parsed) {
      sseWrite(res, { type: "status", message: "Refining output…" });
      rawText = await generateResponse(updatePrompt + "\n\nRETURN ONLY RAW JSON.");
      parsed = await extractJson(rawText);
    }

    if (!parsed?.code) {
      console.error("[changes] AI returned invalid JSON:", rawText?.slice(0, 200));
      sseWrite(res, { type: "error", message: "AI returned an invalid response. Please try again." });
      return res.end();
    }

    website.conversation.push(
      { role: "user", content: prompt },
      { role: "ai", content: parsed.message }
    );
    website.latestCode = parsed.code;

    await Promise.all([website.save(), (user.credits -= 25, user.save())]);

    sseWrite(res, {
      type: "done",
      message: parsed.message,
      code: parsed.code,
      remainingCredits: user.credits,
    });

    res.end();
  } catch (error) {
    console.error("[changes] error:", error);
    sseWrite(res, { type: "error", message: `Update failed: ${error.message}` });
    res.end();
  }
};

// ---------------------------------------------------------------------------
// Read-only endpoints (unchanged)
// ---------------------------------------------------------------------------

export const getWebsiteById = async (req, res) => {
  try {
    const website = await Website.findOne({ _id: req.params.id, user: req.user._id });
    if (!website) return res.status(400).json({ message: "website not found" });
    return res.status(200).json(website);
  } catch (error) {
    return res.status(500).json({ message: `get website by id error ${error}` });
  }
};

export const getAll = async (req, res) => {
  try {
    const websites = await Website.find({ user: req.user._id });
    return res.status(200).json(websites);
  } catch (error) {
    return res.status(500).json({ message: `get all websites error ${error}` });
  }
};

export const deploy = async (req, res) => {
  try {
    const website = await Website.findOne({ _id: req.params.id, user: req.user._id });
    if (!website) return res.status(400).json({ message: "website not found" });

    if (!website.slug) {
      website.slug =
        website.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60) +
        website._id.toString().slice(-5);
    }

    website.deployed = true;
    website.deployUrl = `${process.env.FRONTEND_URL}/site/${website.slug}`;
    await website.save();

    return res.status(200).json({ url: website.deployUrl });
  } catch (error) {
    return res.status(500).json({ message: `deploy website error ${error}` });
  }
};

export const getBySlug = async (req, res) => {
  try {
    const website = await Website.findOne({ slug: req.params.slug });
    if (!website) return res.status(400).json({ message: "website not found" });
    return res.status(200).json(website);
  } catch (error) {
    return res.status(500).json({ message: `get by slug website error ${error}` });
  }
};