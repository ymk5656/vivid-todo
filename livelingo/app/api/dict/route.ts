import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const getGroq = (apiKey: string) => new Groq({ apiKey });

const DIALECT_NOTE: Record<string, string> = {
  "es-MX": "Mexican Spanish",
  "es-CO": "Colombian Spanish",
  "es-ES": "Spain Spanish (Castilian)",
  "es-AR": "Argentinian Spanish",
  "ja-JP": "Standard Japanese (Tokyo standard language)",
  "ja-KS": "Kansai Japanese (Osaka/Kyoto dialect)",
};

export async function POST(req: NextRequest) {
  try {
    const { query, dialect = "es-MX" } = (await req.json()) as {
      query: string;
      dialect?: string;
    };

    if (!query?.trim()) {
      return NextResponse.json({ error: "No query" }, { status: 400 });
    }

    const dialectNote = DIALECT_NOTE[dialect] ?? (dialect.startsWith("ja-") ? "Japanese" : "Spanish");
    const isJapanese = dialect.startsWith("ja-");

    const systemContent = isJapanese
      ? `You are a bilingual Korean-Japanese dictionary assistant. Use ${dialectNote}. Respond with valid JSON only, no extra text.`
      : `You are a bilingual Korean-Spanish dictionary assistant. Use ${dialectNote} for Spanish. Respond with valid JSON only, no extra text.`;

    const userContent = isJapanese
      ? `Look up this word or phrase: "${query.trim()}"

This is a Korean-Japanese dictionary. Always return the JAPANESE word as the primary entry, regardless of whether the input is Korean or Japanese.
- If input is Korean: find the Japanese translation, use it as "word", set lang="ja"
- If input is Japanese: use the Japanese word as "word", set lang="ja"

Return exactly this JSON:
{
  "word": "Japanese word with kanji (e.g. 経済, 食べる, ありがとう)",
  "lang": "ja",
  "pos": "part of speech in Korean (명사/동사/형용사/부사/구절/기타)",
  "translation": "Korean meaning",
  "pronunciation": "hiragana reading (furigana) of the Japanese word — e.g. 経済 → けいざい, 食べる → たべる. Empty string for words already in hiragana/katakana only.",
  "meanings": [
    {
      "definition": "concise Korean definition",
      "example_foreign": "natural example sentence in Japanese",
      "example_ko": "Korean translation of the example"
    }
  ]
}

Provide 1-2 meanings. Keep everything concise.`
      : `Look up this word or phrase: "${query.trim()}"

Auto-detect whether it is Korean or Spanish. Return exactly this JSON:
{
  "word": "the word as given",
  "lang": "es or ko",
  "pos": "part of speech in Korean (명사/동사/형용사/부사/구절/기타)",
  "translation": "primary translation in the other language",
  "pronunciation": "simple phonetic guide — only for Spanish words, else empty string",
  "meanings": [
    {
      "definition": "concise Korean definition",
      "example_foreign": "natural example sentence in Spanish",
      "example_ko": "Korean translation of the example"
    }
  ]
}

Provide 1-2 meanings. Keep everything concise.`;

    const keys = [
      process.env.GROQ_API_KEY_2,
      process.env.GROQ_API_KEY,
    ].map(k => k?.trim()).filter(Boolean) as string[];

    let raw = "{}";
    let lastErr: unknown = null;
    for (const key of keys) {
      try {
        const completion = await getGroq(key).chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
          ],
          temperature: 0.1,
          max_tokens: 600,
          response_format: { type: "json_object" },
        });
        raw = completion.choices[0]?.message?.content ?? "{}";
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error("[Dict] key error:", (err as Error)?.message);
        continue;
      }
    }
    if (lastErr) throw lastErr;

    const entry = JSON.parse(raw);
    return NextResponse.json(entry);
  } catch (err) {
    console.error("[Dict] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
