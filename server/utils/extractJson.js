const extractJson = async (text) => {
    if (!text) {
        return null;
    }
    try {
        const cleaned = text
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .trim();

        const firstBrace = cleaned.indexOf('{');
        const closeBrace = cleaned.lastIndexOf('}');
        if (firstBrace === -1 || closeBrace === -1) return null;
        let jsonString = cleaned.slice(firstBrace, closeBrace + 1);

        try {
            return JSON.parse(jsonString);
        } catch (e) {
            // Fix unescaped control chars and invalid backslash escapes commonly output by LLMs
            const fixedJson = jsonString
                .replace(/[\x00-\x1F]/g, (match) => {
                    if (match === '\n') return '\\n';
                    if (match === '\r') return '\\r';
                    if (match === '\t') return '\\t';
                    return '';
                })
                .replace(/\\([^"\\\/bfnrtu])/g, '$1');

            return JSON.parse(fixedJson);
        }
    } catch (error) {
        console.error("extractJson error:", error.message);
        return null;
    }
}
export default extractJson;