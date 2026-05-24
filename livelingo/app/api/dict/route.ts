import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const getGroq = (apiKey: string) => new Groq({ apiKey });

type LangGroup = "es" | "ja" | "en" | "zh";

function getLang(dialect: string): LangGroup {
  if (dialect.startsWith("ja-")) return "ja";
  if (dialect.startsWith("en-")) return "en";
  if (dialect.startsWith("zh-")) return "zh";
  return "es";
}

const DIALECT_NOTE: Record<string, string> = {
  "es-MX": "Mexican Spanish",
  "es-CO": "Colombian Spanish",
  "es-ES": "Spain Spanish (Castilian)",
  "es-AR": "Argentinian Spanish",
  "ja-JP": "Standard Japanese (Tokyo standard language)",
  "ja-KS": "Kansai Japanese (Osaka/Kyoto dialect)",
  "en-US": "American English",
  "en-GB": "British English",
  "zh-CN": "Simplified Chinese (Mandarin, Mainland China)",
  "zh-TW": "Traditional Chinese (Mandarin, Taiwan)",
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

    const lang = getLang(dialect);
    const dialectNote = DIALECT_NOTE[dialect] ?? dialect;

    let systemContent: string;
    let userContent: string;

    if (lang === "ja") {
      systemContent = `You are a bilingual Korean-Japanese dictionary assistant. Use ${dialectNote}. Respond with valid JSON only, no extra text.`;
      userContent = `Look up this word or phrase: "${query.trim()}"

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

Provide 1-2 meanings. Keep everything concise.`;

    } else if (lang === "en") {
      systemContent = `You are a bilingual Korean-English dictionary assistant. Use ${dialectNote}. Respond with valid JSON only, no extra text.`;
      userContent = `Look up this word or phrase: "${query.trim()}"

This is a Korean-English dictionary. Always return the ENGLISH word as the primary entry, regardless of whether the input is Korean or English.
- If input is Korean: find the English translation, use it as "word", set lang="en"
- If input is English: use the English word as "word", set lang="en"

Return exactly this JSON:
{
  "word": "English word or phrase",
  "lang": "en",
  "pos": "part of speech in Korean (명사/동사/형용사/부사/구절/기타)",
  "translation": "Korean meaning",
  "pronunciation": "IPA pronunciation (e.g. /ɪˈkɒnəmi/ for economy). Use standard IPA notation.",
  "meanings": [
    {
      "definition": "concise Korean definition",
      "example_foreign": "natural example sentence in English",
      "example_ko": "Korean translation of the example"
    }
  ]
}

Provide 1-2 meanings. Keep everything concise.`;

    } else if (lang === "zh") {
      systemContent = `You are a bilingual Korean-Chinese dictionary assistant. Use ${dialectNote}. Respond with valid JSON only, no extra text.`;
      userContent = `Look up this word or phrase: "${query.trim()}"

This is a Korean-Chinese dictionary. Always return the CHINESE word as the primary entry, regardless of whether the input is Korean or Chinese.
- If input is Korean: find the Chinese translation, use it as "word", set lang="zh"
- If input is Chinese: use the Chinese word as "word", set lang="zh"
- Use ${dialect === "zh-TW" ? "Traditional Chinese characters (繁體字)" : "Simplified Chinese characters (简体字)"}

Return exactly this JSON:
{
  "word": "Chinese word (e.g. 经济, 吃饭, 谢谢)",
  "lang": "zh",
  "pos": "part of speech in Korean (명사/동사/형용사/부사/구절/기타)",
  "translation": "Korean meaning",
  "pronunciation": "pinyin with tone marks (e.g. 经济 → jīngjì, 吃饭 → chīfàn). Always include tones.",
  "meanings": [
    {
      "definition": "concise Korean definition",
      "example_foreign": "natural example sentence in Chinese",
      "example_ko": "Korean translation of the example"
    }
  ]
}

Provide 1-2 meanings. Keep everything concise.`;

    } else {
      // Spanish
      systemContent = `You are a bilingual Korean-Spanish dictionary assistant. Use ${dialectNote} for Spanish. Respond with valid JSON only, no extra text.`;
      userContent = `Look up this word or phrase: "${query.trim()}"

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
    }

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
