import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const getGroq = (apiKey: string) => new Groq({ apiKey });

interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

type LangGroup = "es" | "ja" | "en" | "zh";

function getLang(dialect: string): LangGroup {
  if (dialect.startsWith("ja-")) return "ja";
  if (dialect.startsWith("en-")) return "en";
  if (dialect.startsWith("zh-")) return "zh";
  return "es";
}

export async function POST(req: NextRequest) {
  try {
    const { history, dialect = "es-MX" } = (await req.json()) as {
      history: HistoryItem[];
      dialect?: string;
    };

    if (!history?.length) {
      return NextResponse.json({ error: "No history" }, { status: 400 });
    }

    const conversationText = history
      .map((h) => `${h.role === "user" ? "학습자" : "AI"}: ${h.content}`)
      .join("\n");

    const dialectNote: Record<string, string> = {
      "es-MX": "멕시코 스페인어",
      "es-CO": "콜롬비아 스페인어",
      "es-ES": "스페인어(카스티야)",
      "es-AR": "아르헨티나 스페인어",
      "ja-JP": "표준 일본어(도쿄)",
      "ja-KS": "간사이 방언(오사카·교토)",
      "en-US": "미국 영어",
      "en-GB": "영국 영어",
      "zh-CN": "중국어(보통화, 간체)",
      "zh-TW": "중국어(보통화, 번체)",
    };

    const lang = getLang(dialect);
    const langNote = dialectNote[dialect] ?? (lang === "ja" ? "일본어" : lang === "en" ? "영어" : lang === "zh" ? "중국어" : "스페인어");

    let userContent: string;

    if (lang === "ja") {
      userContent = `다음 일본어 대화에서 학습에 유용한 핵심 단어 10개와 핵심 표현 5개를 추출하세요.

대화:
${conversationText}

반드시 아래 JSON 형식으로만 답하세요:
{
  "words": [
    {
      "word": "일본어 단어 (한자가 있으면 한자 포함)",
      "reading": "히라가나 읽기 — 예: 経済 → けいざい, 食べる → たべる. 히라가나·가타카나만으로 된 단어는 빈 문자열",
      "pos": "품사 한국어(명사/동사/형용사/부사/기타)",
      "translation": "한국어 뜻",
      "example": "짧은 예문(일본어)"
    }
  ],
  "expressions": [
    {
      "expression": "일본어 표현",
      "translation": "한국어 번역",
      "usage": "언제 어떻게 쓰는지 한국어 설명 1문장"
    }
  ]
}

words는 정확히 10개, expressions는 정확히 5개. 대화에 실제로 등장한 단어/표현 위주로 선택하되, 부족하면 관련 어휘를 추가하세요.`;

    } else if (lang === "en") {
      userContent = `다음 영어 대화에서 학습에 유용한 핵심 단어 10개와 핵심 표현 5개를 추출하세요.

대화:
${conversationText}

반드시 아래 JSON 형식으로만 답하세요:
{
  "words": [
    {
      "word": "영어 단어",
      "pos": "품사 한국어(명사/동사/형용사/부사/기타)",
      "translation": "한국어 뜻",
      "example": "짧은 예문(영어)"
    }
  ],
  "expressions": [
    {
      "expression": "영어 표현",
      "translation": "한국어 번역",
      "usage": "언제 어떻게 쓰는지 한국어 설명 1문장"
    }
  ]
}

words는 정확히 10개, expressions는 정확히 5개. 대화에 실제로 등장한 단어/표현 위주로 선택하되, 부족하면 관련 어휘를 추가하세요.`;

    } else if (lang === "zh") {
      userContent = `다음 중국어 대화에서 학습에 유용한 핵심 단어 10개와 핵심 표현 5개를 추출하세요.

대화:
${conversationText}

반드시 아래 JSON 형식으로만 답하세요:
{
  "words": [
    {
      "word": "중국어 단어 (한자)",
      "reading": "병음(성조 포함) — 예: 经济 → jīngjì, 吃饭 → chīfàn",
      "pos": "품사 한국어(명사/동사/형용사/부사/기타)",
      "translation": "한국어 뜻",
      "example": "짧은 예문(중국어)"
    }
  ],
  "expressions": [
    {
      "expression": "중국어 표현",
      "translation": "한국어 번역",
      "usage": "언제 어떻게 쓰는지 한국어 설명 1문장"
    }
  ]
}

words는 정확히 10개, expressions는 정확히 5개. 대화에 실제로 등장한 단어/표현 위주로 선택하되, 부족하면 관련 어휘를 추가하세요.`;

    } else {
      // Spanish
      userContent = `다음 스페인어 대화에서 학습에 유용한 핵심 단어 10개와 핵심 표현 5개를 추출하세요.

대화:
${conversationText}

반드시 아래 JSON 형식으로만 답하세요:
{
  "words": [
    {
      "word": "스페인어 단어",
      "pos": "품사 한국어(명사/동사/형용사/부사/기타)",
      "translation": "한국어 뜻",
      "example": "짧은 예문(스페인어)"
    }
  ],
  "expressions": [
    {
      "expression": "스페인어 표현",
      "translation": "한국어 번역",
      "usage": "언제 어떻게 쓰는지 한국어 설명 1문장"
    }
  ]
}

words는 정확히 10개, expressions는 정확히 5개. 대화에 실제로 등장한 단어/표현 위주로 선택하되, 부족하면 관련 어휘를 추가하세요.`;
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
            {
              role: "system",
              content:
                `You are a ${langNote} language learning assistant. ` +
                "Analyze the conversation and extract key vocabulary and expressions. " +
                "Respond with valid JSON only, no extra text.",
            },
            { role: "user", content: userContent },
          ],
          temperature: 0.3,
          max_tokens: 1400,
          response_format: { type: "json_object" },
        });
        raw = completion.choices[0]?.message?.content ?? "{}";
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error("[Summary] key error:", (err as Error)?.message);
        continue;
      }
    }
    if (lastErr) throw lastErr;

    const result = JSON.parse(raw) as {
      words?: unknown[];
      expressions?: unknown[];
    };
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Summary] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
