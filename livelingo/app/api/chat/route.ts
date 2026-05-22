import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY });

const FORMAT_INSTRUCTION = `

반드시 아래 형식으로만 답변할 것:
[스페인어 답변]
---TRADUCCIÓN---
[한국어 번역 — 오직 한글(가나다), 숫자, 공백, 문장부호만 허용. 일본어·중국어·베트남어 등 다른 언어 문자 절대 금지]
---CORRECCIÓN---
[한국어 교정 — 오류가 있으면 한국어로만, 없으면 반드시 "없음"만 쓸 것]`;

const BASE_PROMPTS: Record<string, string> = {
  "es-MX": "Eres un tutor de conversación en español mexicano. Habla de forma natural y amigable usando vocabulario y expresiones típicas de México.",
  "es-CO": "Eres un tutor de conversación en español colombiano. Habla de forma clara y amigable usando expresiones típicas de Colombia.",
  "es-ES": "Eres un tutor de conversación en español de España (castellano). Usa el tuteo y el vosotros cuando corresponda, así como expresiones típicas de España.",
  "es-AR": "Eres un tutor de conversación en español argentino. Usa el voseo (vos, tenés, hablás), lunfardo ocasional y expresiones típicas de Argentina.",
};

const PROACTIVE_INSTRUCTION = " Tú eres el líder de la conversación: siempre termina tu respuesta con una pregunta natural o una propuesta de tema para que el estudiante tenga algo concreto a lo que responder. Nunca dejes la conversación sin dirección.";

const GENDER_ADDON: Record<string, string> = {
  male: " Habla con un estilo masculino, directo y relajado.",
  female: " Habla con un estilo femenino, cálido y expresivo.",
};

const LEVEL_INSTRUCTIONS: Record<string, string> = {
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

function buildSystemPrompt(dialect: string, gender: string, level: string): string {
  const base = BASE_PROMPTS[dialect] ?? BASE_PROMPTS["es-MX"];
  const genderAddon = GENDER_ADDON[gender] ?? "";
  const levelInstruction = LEVEL_INSTRUCTIONS[level] ?? LEVEL_INSTRUCTIONS["beginner"];
  return base + genderAddon + PROACTIVE_INSTRUCTION + levelInstruction + FORMAT_INSTRUCTION;
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

    const FORMAT_REMINDER = "\n\n[반드시 형식: 스페인어답변\n---TRADUCCIÓN---\n한국어번역\n---CORRECCIÓN---\n교정또는없음]";

    let userContent: string;
    if (trigger === "greet") {
      userContent = "[INICIO] El estudiante acaba de abrir la app. Salúdalo calurosamente, preséntate brevemente y pregúntale qué tema le gustaría practicar hoy.";
    } else if (trigger === "followup") {
      userContent = "[SILENCIO] El estudiante lleva un rato sin responder. Retoma la conversación de forma natural: haz una pregunta sobre lo que se habló, propone un tema nuevo o invítalo a seguir practicando.";
    } else {
      userContent = message ?? "";
    }

    const completion = await getGroq().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        ...history.slice(-10).map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        })),
        { role: "user", content: userContent + FORMAT_REMINDER },
      ],
      temperature: 0.7,
      max_tokens: 512,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = parseResponse(raw);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
