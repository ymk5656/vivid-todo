import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const getGroq = (apiKey: string) => new Groq({ apiKey });

function isJapanese(dialect: string) { return dialect.startsWith("ja-"); }

// ── Spanish prompts ──────────────────────────────────────────────────────────

const FORMAT_INSTRUCTION_ES = `

반드시 아래 형식으로만 답변할 것:
[스페인어 답변]
---TRADUCCIÓN---
[한국어 번역 — 오직 한글(가나다), 숫자, 공백, 문장부호만 허용. 일본어·중국어·베트남어 등 다른 언어 문자 절대 금지]
---CORRECCIÓN---
[한국어 교정 — 오류가 있으면 한국어로만, 없으면 반드시 "없음"만 쓸 것]`;

const BASE_PROMPTS_ES: Record<string, string> = {
  "es-MX": "Eres un tutor de conversación en español mexicano. Habla de forma natural y amigable usando vocabulario y expresiones típicas de México.",
  "es-CO": "Eres un tutor de conversación en español colombiano. Habla de forma clara y amigable usando expresiones típicas de Colombia.",
  "es-ES": "Eres un tutor de conversación en español de España (castellano). Usa el tuteo y el vosotros cuando corresponda, así como expresiones típicas de España.",
  "es-AR": "Eres un tutor de conversación en español argentino. Usa el voseo (vos, tenés, hablás), lunfardo ocasional y expresiones típicas de Argentina.",
};

const PROACTIVE_INSTRUCTION_ES = " Tú eres el líder de la conversación: siempre termina tu respuesta con una pregunta natural o una propuesta de tema para que el estudiante tenga algo concreto a lo que responder. Nunca dejes la conversación sin dirección.";

const GENDER_ADDON_ES: Record<string, string> = {
  male: " Habla con un estilo masculino, directo y relajado.",
  female: " Habla con un estilo femenino, cálido y expresivo.",
};

const LEVEL_INSTRUCTIONS_ES: Record<string, string> = {
  beginner: `
Nivel: PRINCIPIANTE.
- Responde con frases muy cortas y sencillas (1-2 oraciones máximo).
- Usa vocabulario básico y cotidiano únicamente.
- REGLA OBLIGATORIA: Si el mensaje del usuario tiene 3 palabras o menos (como "sí", "bien", "no sé", "me gusta"), SIEMPRE debes primero escribir esta línea exacta antes de tu respuesta normal: "¿Quisiste decir: «[aquí escribe una oración completa natural en español que el usuario probablemente quiso decir]»?" — rellena los corchetes con la oración sugerida real.`,

  intermediate: `
Nivel: INTERMEDIO.
- Responde con 2-3 oraciones de longitud media.
- Usa vocabulario variado pero accesible.
- REGLA OBLIGATORIA: Si el mensaje del usuario tiene 3 palabras o menos, SIEMPRE escribe primero: "¿Quisiste decir: «[oración completa sugerida]»?" — rellena los corchetes con la oración sugerida real.`,

  advanced: `
Nivel: AVANZADO.
- Responde con 3-5 oraciones usando expresiones naturales, modismos y gramática compleja.
- Amplía el vocabulario con sinónimos y giros idiomáticos.
- REGLA OBLIGATORIA: Si el mensaje del usuario tiene 3 palabras o menos, SIEMPRE empieza con: "¿Quisiste decir: «[versión avanzada y elaborada]»?" — rellena los corchetes con la expresión real.`,
};

// ── Japanese prompts ─────────────────────────────────────────────────────────

const FORMAT_INSTRUCTION_JA = `

반드시 아래 형식으로만 답변할 것:
[일본어 답변]
---TRADUCCIÓN---
[한국어 번역 — 오직 한글(가나다), 숫자, 공백, 문장부호만 허용. 스페인어·중국어·베트남어 등 다른 언어 문자 절대 금지]
---CORRECCIÓN---
[한국어 교정 — 오류가 있으면 한국어로만, 없으면 반드시 "없음"만 쓸 것]`;

const BASE_PROMPTS_JA: Record<string, string> = {
  "ja-JP": "あなたは日本語会話チューターです。自然で親しみやすい標準語（東京・共通語）で話し、日本の日常的な語彙と表現を使ってください。",
  "ja-KS": "あなたは日本語会話チューターです。関西弁（大阪・京都の方言）で話し、「やん」「やで」「なんでやねん」などの関西弁特有の表現を自然に使ってください。",
};

const PROACTIVE_INSTRUCTION_JA = " あなたが会話をリードしてください。常に返答の最後に自然な質問や話題提案を付けて、学習者が答えやすいようにしてください。";

const GENDER_ADDON_JA: Record<string, string> = {
  male: " 男性らしく、自然で落ち着いたスタイルで話してください。",
  female: " 女性らしく、温かく親しみやすいスタイルで話してください。",
};

const LEVEL_INSTRUCTIONS_JA: Record<string, string> = {
  beginner: `
レベル：初級。
- とても短く簡単な文（1〜2文）で答えてください。
- ひらがな・カタカナを中心に、基本的な漢字のみ使用してください。
- 必要に応じてひらがなのふりがなを付けてください。
- OBLIGATORY RULE: ユーザーのメッセージが3語以下（例：「はい」「好き」「わからない」）なら、必ず最初に「もしかして：「[ここに自然な日本語の完全な文を入れてください]」と言いたかったですか？」と書いてから通常の返答を続けてください。`,

  intermediate: `
レベル：中級。
- 2〜3文で答えてください。
- 多様な語彙を使い、一般的な漢字も使用してください。
- OBLIGATORY RULE: ユーザーのメッセージが3語以下なら、必ず最初に「もしかして：「[完全な文の提案]」と言いたかったですか？」と書いてください。`,

  advanced: `
レベル：上級。
- 3〜5文でイディオムや自然な表現を使って答えてください。
- 高度な語彙と文法を使ってください。
- OBLIGATORY RULE: ユーザーのメッセージが3語以下なら、必ず最初に「もしかして：「[上級的な表現の提案]」と言いたかったですか？」と書いてください。`,
};

// ── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(dialect: string, gender: string, level: string): string {
  if (isJapanese(dialect)) {
    const base = BASE_PROMPTS_JA[dialect] ?? BASE_PROMPTS_JA["ja-JP"];
    const genderAddon = GENDER_ADDON_JA[gender] ?? "";
    const levelInstruction = LEVEL_INSTRUCTIONS_JA[level] ?? LEVEL_INSTRUCTIONS_JA["beginner"];
    return base + genderAddon + PROACTIVE_INSTRUCTION_JA + levelInstruction + FORMAT_INSTRUCTION_JA;
  }
  const base = BASE_PROMPTS_ES[dialect] ?? BASE_PROMPTS_ES["es-MX"];
  const genderAddon = GENDER_ADDON_ES[gender] ?? "";
  const levelInstruction = LEVEL_INSTRUCTIONS_ES[level] ?? LEVEL_INSTRUCTIONS_ES["beginner"];
  return base + genderAddon + PROACTIVE_INSTRUCTION_ES + levelInstruction + FORMAT_INSTRUCTION_ES;
}

interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

// Strip obvious non-Korean foreign scripts; fall back to raw text if nothing survives
function enforceKorean(text: string): string {
  const cleaned = text.replace(/[^가-힣ᄀ-ᇿ㄰-㆏\s\d.,!?~…'"()\-]/g, "").trim();
  return cleaned || text.trim();
}

function parseResponse(raw: string): {
  spanish: string;
  korean: string;
  correction: string;
} {
  const parts = raw.split(/---TRADUCCIÓN---/);
  if (parts.length < 2) {
    return { spanish: raw.trim(), korean: "", correction: "없음" };
  }
  const spanish = parts[0].trim();
  const rest = parts[1].split(/---CORRECCIÓN---/);
  const korean = enforceKorean(rest[0].trim());
  const rawCorrection = rest[1]?.trim() ?? "없음";
  const correction = rawCorrection === "없음" ? "없음" : enforceKorean(rawCorrection) || "없음";
  return { spanish, korean, correction };
}

export async function POST(req: NextRequest) {
  try {
    const { message, trigger, dialect, gender = "female", level = "beginner", history = [] } = await req.json() as {
      message?: string;
      trigger?: "greet" | "followup";
      dialect: string;
      gender?: string;
      level?: string;
      history: HistoryItem[];
    };

    const systemPrompt = buildSystemPrompt(dialect, gender, level);

    const FORMAT_REMINDER = isJapanese(dialect)
      ? "\n\n[반드시 형식: 일본어답변\n---TRADUCCIÓN---\n한국어번역\n---CORRECCIÓN---\n교정또는없음]"
      : "\n\n[반드시 형식: 스페인어답변\n---TRADUCCIÓN---\n한국어번역\n---CORRECCIÓN---\n교정또는없음]";

    let userContent: string;
    if (isJapanese(dialect)) {
      if (trigger === "greet") {
        userContent = "[開始] 学習者がアプリを開きました。日本語で温かく挨拶し、簡単に自己紹介して、今日どんなトピックを練習したいか聞いてください。";
      } else if (trigger === "followup") {
        userContent = "[沈黙] 学習者がしばらく返答していません。自然に会話を続けてください。";
      } else {
        userContent = message ?? "";
      }
    } else {
      if (trigger === "greet") {
        userContent = "[INICIO] El estudiante acaba de abrir la app. Salúdalo calurosamente, preséntate brevemente y pregúntale qué tema le gustaría practicar hoy.";
      } else if (trigger === "followup") {
        userContent = "[SILENCIO] El estudiante lleva un rato sin responder. Retoma la conversación de forma natural: haz una pregunta sobre lo que se habló, propone un tema nuevo o invítalo a seguir practicando.";
      } else {
        userContent = message ?? "";
      }
    }

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      ...history.slice(-10).map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user" as const, content: userContent + FORMAT_REMINDER },
    ];

    const keys = [
      process.env.GROQ_API_KEY_2,
      process.env.GROQ_API_KEY,
    ].map(k => k?.trim()).filter(Boolean) as string[];
    console.log(`[key-rotation] keys available: ${keys.length}, lengths: ${keys.map(k => k.length).join(",")}`);


    let completion: Awaited<ReturnType<ReturnType<typeof getGroq>["chat"]["completions"]["create"]>> | null = null;

    for (const key of keys) {
      try {
        console.log(`[key-rotation] trying key ...${key.slice(-8)}`);
        completion = await getGroq(key).chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: chatMessages,
          temperature: 0.7,
          max_tokens: 512,
        });
        console.log(`[key-rotation] success with key ...${key.slice(-8)}`);
        break;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        const errMsg = (err as Error)?.message;
        console.error(`[key-rotation] key ...${key.slice(-8)} error: status=${status} msg=${errMsg}`);
        continue;
      }
    }

    if (!completion) {
      console.error("[key-rotation] all keys rate limited");
      return NextResponse.json({ error: "rate_limit" }, { status: 429 });
    }

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = parseResponse(raw);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Chat API error:", err);
    const status = (err as { status?: number })?.status;
    const msg = (err as Error)?.message ?? String(err);
    const name = (err as Error)?.name ?? "unknown";
    if (status === 429) {
      return NextResponse.json({ error: "rate_limit" }, { status: 429 });
    }
    return NextResponse.json({ error: "Internal server error", _debug: msg, _status: status, _name: name }, { status: 500 });
  }
}
