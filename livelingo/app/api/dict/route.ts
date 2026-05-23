import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

Auto-detect whether it is Korean or Japanese. Return exactly this JSON:
{
  "word": "the word as given",
  "lang": "ja or ko",
  "pos": "part of speech in Korean (명사/동사/형용사/부사/구절/기타)",
  "translation": "primary translation in the other language",
  "pronunciation": "romaji or furigana pronunciation — only for Japanese words, else empty string",
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

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const entry = JSON.parse(raw);
    return NextResponse.json(entry);
  } catch (err) {
    console.error("[Dict] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
