import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY });

interface HistoryItem {
  role: "user" | "assistant";
  content: string;
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
    };

    const isJapanese = dialect.startsWith("ja-");
    const langNote = dialectNote[dialect] ?? (isJapanese ? "일본어" : "스페인어");

    const userContent = isJapanese
      ? `다음 일본어 대화에서 학습에 유용한 핵심 단어 10개와 핵심 표현 5개를 추출하세요.

대화:
${conversationText}

반드시 아래 JSON 형식으로만 답하세요:
{
  "words": [
    {
      "word": "일본어 단어",
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

words는 정확히 10개, expressions는 정확히 5개. 대화에 실제로 등장한 단어/표현 위주로 선택하되, 부족하면 관련 어휘를 추가하세요.`
      : `다음 스페인어 대화에서 학습에 유용한 핵심 단어 10개와 핵심 표현 5개를 추출하세요.

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

    const completion = await getGroq().chat.completions.create({
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

    const raw = completion.choices[0]?.message?.content ?? "{}";
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
