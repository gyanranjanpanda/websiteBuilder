/**
 * Extracts { message, code } from a raw LLM response string.
 *
 * LLMs often output JSON where the "code" field contains an entire HTML document
 * with unescaped newlines, quotes, and backslashes — making JSON.parse fail.
 * This parser handles that by extracting the code value with a targeted regex
 * rather than trying to parse the whole blob.
 */
const extractJson = async (text) => {
    if (!text) return null;

    try {
        // Strip markdown fences if present
        const cleaned = text
            .replace(/```json\s*/gi, "")
            .replace(/```\s*/g, "")
            .trim();

        // ── Attempt 1: standard JSON.parse (fast path for well-formed output) ──
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            const candidate = cleaned.slice(firstBrace, lastBrace + 1);
            try {
                const result = JSON.parse(candidate);
                if (result?.code) return result;
            } catch (_) {
                // fall through to manual extraction
            }
        }

        // ── Attempt 2: fix common LLM escaping issues and retry parse ──
        if (firstBrace !== -1 && lastBrace !== -1) {
            const candidate = cleaned.slice(firstBrace, lastBrace + 1);
            try {
                const fixed = candidate
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // strip non-printable except \n \r \t
                    .replace(/\n/g, "\\n")
                    .replace(/\r/g, "\\r")
                    .replace(/\t/g, "\\t")
                    .replace(/\\([^"\\/bfnrtu])/g, "\\\\$1"); // fix bad backslash escapes

                const result = JSON.parse(fixed);
                if (result?.code) return result;
            } catch (_) {
                // fall through to regex extraction
            }
        }

        // ── Attempt 3: regex-based field extraction (most resilient) ──
        // Extract "message" — always a short string, safe to regex
        const messageMatch = cleaned.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const message = messageMatch ? messageMatch[1] : "";

        // Extract "code" — find the value between the first `"code":"` and the
        // matching closing `"` that is followed by the final `}`.
        // We search for the marker and take everything up to the last `"}`
        const codeStart = cleaned.indexOf('"code"');
        if (codeStart === -1) return null;

        // Move past: "code" : "
        let valueStart = cleaned.indexOf('"', codeStart + 6);
        if (valueStart === -1) return null;
        valueStart += 1; // skip the opening quote

        // The code value ends at the last `"}` in the string (the JSON closing)
        const codeEnd = cleaned.lastIndexOf('"}');
        if (codeEnd === -1 || codeEnd <= valueStart) return null;

        let code = cleaned.slice(valueStart, codeEnd);

        // Unescape basic JSON string escapes that the LLM did output correctly
        code = code
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");

        if (!code.trim()) return null;

        return { message, code };

    } catch (error) {
        console.error("extractJson error:", error.message);
        return null;
    }
};

export default extractJson;