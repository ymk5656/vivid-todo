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

// ── Spanish prompts ──────────────────────────────────────────────────────────

const FORMAT_INSTRUCTION_ES = `

반드시 아래 형식으로만 답변할 것:
[스페인어 답변]
---TRADUCCIÓN---
[한국어 번역 — 오직 한글(가나다), 숫자, 공백, 문장부호만 허용. 다른 언어 문자 절대 금지]
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
- Responde con 2-3 oraciones usando expresiones naturales, modismos y gramática compleja.
- Amplía el vocabulario con sinónimos y giros idiomáticos.
- REGLA OBLIGATORIA: Si el mensaje del usuario tiene 3 palabras o menos, SIEMPRE empieza con: "¿Quisiste decir: «[versión avanzada y elaborada]»?" — rellena los corchetes con la expresión real.`,
};

// ── Japanese prompts ─────────────────────────────────────────────────────────

const FORMAT_INSTRUCTION_JA = `

반드시 아래 형식으로만 답변할 것:
[일본어 답변]
---TRADUCCIÓN---
[한국어 번역 — 오직 한글(가나다), 숫자, 공백, 문장부호만 허용. 다른 언어 문자 절대 금지]
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
- 2〜3文でイディオムや自然な表現を使って答えてください。
- 高度な語彙と文法を使ってください。
- OBLIGATORY RULE: ユーザーのメッセージが3語以下なら、必ず最初に「もしかして：「[上級的な表現の提案]」と言いたかったですか？」と書いてください。`,
};

// ── English prompts ──────────────────────────────────────────────────────────

const FORMAT_INSTRUCTION_EN = `

IMPORTANT — reply using this EXACT format (replace the ↓ placeholder lines):
Your English reply goes here.
---TRADUCCIÓN---
한국어 번역이 여기에 옵니다. (Korean characters only — no English, no Chinese, no other scripts)
---CORRECCIÓN---
없음
(If user made grammar errors, replace 없음 with a Korean-only correction. Otherwise keep 없음 exactly as shown.)`;

const BASE_PROMPTS_EN: Record<string, string> = {
  "en-US": "You are an English conversation tutor using American English. Speak in a natural, friendly style with typical American expressions and vocabulary.",
  "en-GB": "You are an English conversation tutor using British English. Speak in a natural, friendly style with typical British expressions, spelling, and vocabulary.",
};

const PROACTIVE_INSTRUCTION_EN = " You lead the conversation: always end your response with a natural question or topic suggestion so the learner has something concrete to respond to. Never leave the conversation without direction.";

const GENDER_ADDON_EN: Record<string, string> = {
  male: " Speak in a casual, relaxed masculine style.",
  female: " Speak in a warm, expressive feminine style.",
};

const LEVEL_INSTRUCTIONS_EN: Record<string, string> = {
  beginner: `
Level: BEGINNER.
- Respond with very short, simple sentences (1-2 sentences max).
- Use only basic, everyday vocabulary.
- OBLIGATORY RULE: If the user's message is 3 words or fewer (e.g., "yes", "I like", "don't know"), ALWAYS write this line first before your normal response: "Did you mean: «[write a complete natural English sentence the user probably meant]»?" — fill in the brackets with the actual suggested sentence.`,

  intermediate: `
Level: INTERMEDIATE.
- Respond with 2-3 medium-length sentences.
- Use varied but accessible vocabulary.
- OBLIGATORY RULE: If the user's message is 3 words or fewer, ALWAYS write first: "Did you mean: «[complete suggested sentence]»?" — fill in the brackets with the actual suggested sentence.`,

  advanced: `
Level: ADVANCED.
- Respond with 2-3 sentences using natural expressions, idioms, and complex grammar.
- Expand vocabulary with synonyms and idiomatic phrases.
- OBLIGATORY RULE: If the user's message is 3 words or fewer, ALWAYS start with: "Did you mean: «[advanced, elaborate version]»?" — fill in the brackets with the actual expression.`,
};

// ── Chinese prompts ───────────────────────────────────────────────────────────

const FORMAT_INSTRUCTION_ZH = `

반드시 아래 형식으로만 답변할 것:
[중국어 답변]
---TRADUCCIÓN---
[한국어 번역 — 오직 한글(가나다), 숫자, 공백, 문장부호만 허용. 다른 언어 문자 절대 금지]
---CORRECCIÓN---
[한국어 교정 — 오류가 있으면 한국어로만, 없으면 반드시 "없음"만 쓸 것]`;

const BASE_PROMPTS_ZH: Record<string, string> = {
  "zh-CN": "你是一位普通话会话辅导老师。请用自然、友好的标准普通话交谈，使用中国大陆常见的词汇和表达方式（简体字）。",
  "zh-TW": "你是一位中文會話輔導老師。請用自然、友好的台灣中文交談，使用台灣常見的詞彙和表達方式（繁體字）。",
};

const PROACTIVE_INSTRUCTION_ZH = " 你来引导对话：每次回答结尾都要提出一个自然的问题或话题建议，让学习者有具体的内容可以回应。对话不要没有方向。";

const GENDER_ADDON_ZH: Record<string, string> = {
  male: " 请用自然、随和的男性风格说话。",
  female: " 请用温暖、亲切的女性风格说话。",
};

const LEVEL_INSTRUCTIONS_ZH: Record<string, string> = {
  beginner: `
级别：初级。
- 用非常简短的句子回答（最多1-2句）。
- 只使用基础、日常词汇。
- 重要规则：如果用户的消息只有3个词或更少（如"你好"、"我喜欢"、"不知道"），请务必先写："你是想说：「[在这里写一个完整的自然中文句子]」吗？" — 括号内填写实际建议的句子，然后再继续正常回复。`,

  intermediate: `
级别：中级。
- 用2-3句中等长度的句子回答。
- 使用多样但易懂的词汇。
- 重要规则：如果用户消息只有3个词或更少，请务必先写："你是想说：「[完整句子建议]」吗？"`,

  advanced: `
级别：高级。
- 用2-3句话回答，使用自然表达、成语和复杂语法。
- 丰富词汇，使用同义词和惯用语。
- 重要规则：如果用户消息只有3个词或更少，请务必先写："你是想说：「[高级、完整的表达]」吗？"`,
};

// ── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(dialect: string, gender: string, level: string): string {
  const lang = getLang(dialect);

  if (lang === "ja") {
    const base = BASE_PROMPTS_JA[dialect] ?? BASE_PROMPTS_JA["ja-JP"];
    const genderAddon = GENDER_ADDON_JA[gender] ?? "";
    const levelInstruction = LEVEL_INSTRUCTIONS_JA[level] ?? LEVEL_INSTRUCTIONS_JA["beginner"];
    return base + genderAddon + PROACTIVE_INSTRUCTION_JA + levelInstruction + FORMAT_INSTRUCTION_JA;
  }
  if (lang === "en") {
    const base = BASE_PROMPTS_EN[dialect] ?? BASE_PROMPTS_EN["en-US"];
    const genderAddon = GENDER_ADDON_EN[gender] ?? "";
    const levelInstruction = LEVEL_INSTRUCTIONS_EN[level] ?? LEVEL_INSTRUCTIONS_EN["beginner"];
    return base + genderAddon + PROACTIVE_INSTRUCTION_EN + levelInstruction + FORMAT_INSTRUCTION_EN;
  }
  if (lang === "zh") {
    const base = BASE_PROMPTS_ZH[dialect] ?? BASE_PROMPTS_ZH["zh-CN"];
    const genderAddon = GENDER_ADDON_ZH[gender] ?? "";
    const levelInstruction = LEVEL_INSTRUCTIONS_ZH[level] ?? LEVEL_INSTRUCTIONS_ZH["beginner"];
    return base + genderAddon + PROACTIVE_INSTRUCTION_ZH + levelInstruction + FORMAT_INSTRUCTION_ZH;
  }
  // Spanish (default)
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
  let koreanRaw = rest[0].trim();
  let correctionRaw = rest[1]?.trim() ?? "없음";

  // Pattern A: LLM inserts "---한국어 번역---" sub-header after echoing the foreign text
  const subHeaderMatch = koreanRaw.match(/---[^\n]*번역[^\n]*---\s*([\s\S]+)/);
  if (subHeaderMatch) {
    koreanRaw = subHeaderMatch[1].trim();
  } else {
    // Strip leading lines without Korean characters (LLM sometimes echoes the foreign reply first)
    const lines = koreanRaw.split('\n');
    const firstKoreanIdx = lines.findIndex(l => /[가-힣]/.test(l));
    if (firstKoreanIdx > 0) koreanRaw = lines.slice(firstKoreanIdx).join('\n').trim();

    // Pattern B: LLM accidentally placed the Korean translation in the CORRECCIÓN section.
    // Detect: TRADUCCIÓN section has no Korean chars, CORRECCIÓN section does.
    if (!/[가-힣]/.test(koreanRaw) && /[가-힣]/.test(correctionRaw) && correctionRaw !== "없음") {
      koreanRaw = correctionRaw;
      correctionRaw = "없음";
    }
  }

  const korean = enforceKorean(koreanRaw);
  const correction = correctionRaw === "없음" ? "없음" : enforceKorean(correctionRaw) || "없음";
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

    const lang = getLang(dialect);
    const systemPrompt = buildSystemPrompt(dialect, gender, level);

    const FORMAT_REMINDER =
      lang === "ja"
        ? "\n\n반드시 형식 준수: 일본어답변\n---TRADUCCIÓN---\n한국어번역(한글만)\n---CORRECCIÓN---\n없음(또는교정내용)"
        : lang === "en"
        ? "\n\n반드시 형식 준수: 영어답변\n---TRADUCCIÓN---\n한국어번역(한글만)\n---CORRECCIÓN---\n없음(또는교정내용)"
        : lang === "zh"
        ? "\n\n반드시 형식 준수: 중국어답변\n---TRADUCCIÓN---\n한국어번역(한글만)\n---CORRECCIÓN---\n없음(또는교정내용)"
        : "\n\n반드시 형식 준수: 스페인어답변\n---TRADUCCIÓN---\n한국어번역(한글만)\n---CORRECCIÓN---\n없음(또는교정내용)";

    let userContent: string;
    if (lang === "ja") {
      if (trigger === "greet") {
        userContent = "[開始] 学習者がアプリを開きました。日本語で温かく挨拶し、簡単に自己紹介して、今日どんなトピックを練習したいか聞いてください。";
      } else if (trigger === "followup") {
        userContent = "[沈黙] 学習者がしばらく返答していません。自然に会話を続けてください。";
      } else {
        userContent = message ?? "";
      }
    } else if (lang === "en") {
      if (trigger === "greet") {
        userContent = "[START] The learner just opened the app. Greet them warmly in English, introduce yourself briefly, and ask what topic they'd like to practice today.";
      } else if (trigger === "followup") {
        userContent = "[SILENCE] The learner hasn't responded for a while. Continue the conversation naturally in English with a new question or topic.";
      } else {
        userContent = message ?? "";
      }
    } else if (lang === "zh") {
      if (trigger === "greet") {
        userContent = "[开始] 学习者刚打开了应用。请用中文热情地打招呼，简单自我介绍，然后问他们今天想练习什么话题。";
      } else if (trigger === "followup") {
        userContent = "[沉默] 学习者一段时间没有回复。请自然地继续对话，提出新问题或话题。";
      } else {
        userContent = message ?? "";
      }
    } else {
      // Spanish
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
