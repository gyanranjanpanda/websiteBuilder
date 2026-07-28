const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions"
const freeModels = [
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "inclusionai/ling-3.0-flash:free"
]

export const generateResponse = async (prompt) => {
    const res = await fetch(openRouterUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            models: freeModels,
            messages: [
                { role: "system", content: "You must return ONLY valid raw JSON." },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0.2,
            max_tokens: 8000
        }),
    });

if(!res.ok){
    const err=await res.text()
    throw new Error("openRouter err"+err)
}

const data=await res.json()
return data.choices[0].message.content

}
