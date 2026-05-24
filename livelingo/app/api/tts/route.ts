import { NextRequest, NextResponse } from "next/server";

const VOICES: Record<string, Record<string, { languageCode: string; name: string; ssmlGender: string }>> = {
  "es-MX": {
    female: { languageCode: "es-US", name: "es-US-Neural2-A", ssmlGender: "FEMALE" },
    male:   { languageCode: "es-US", name: "es-US-Neural2-B", ssmlGender: "MALE" },
  },
  "es-CO": {
    female: { languageCode: "es-US", name: "es-US-Neural2-A", ssmlGender: "FEMALE" },
    male:   { languageCode: "es-US", name: "es-US-Neural2-B", ssmlGender: "MALE" },
  },
  "es-AR": {
    female: { languageCode: "es-US", name: "es-US-Neural2-A", ssmlGender: "FEMALE" },
    male:   { languageCode: "es-US", name: "es-US-Neural2-B", ssmlGender: "MALE" },
  },
  "es-ES": {
    female: { languageCode: "es-ES", name: "es-ES-Neural2-A", ssmlGender: "FEMALE" },
    male:   { languageCode: "es-ES", name: "es-ES-Neural2-B", ssmlGender: "MALE" },
  },
  "ja-JP": {
    female: { languageCode: "ja-JP", name: "ja-JP-Neural2-B", ssmlGender: "FEMALE" },
    male:   { languageCode: "ja-JP", name: "ja-JP-Neural2-C", ssmlGender: "MALE" },
  },
  "ja-KS": {
    female: { languageCode: "ja-JP", name: "ja-JP-Neural2-B", ssmlGender: "FEMALE" },
    male:   { languageCode: "ja-JP", name: "ja-JP-Neural2-C", ssmlGender: "MALE" },
  },
  "en-US": {
    female: { languageCode: "en-US", name: "en-US-Neural2-F", ssmlGender: "FEMALE" },
    male:   { languageCode: "en-US", name: "en-US-Neural2-D", ssmlGender: "MALE" },
  },
  "en-GB": {
    female: { languageCode: "en-GB", name: "en-GB-Neural2-A", ssmlGender: "FEMALE" },
    male:   { languageCode: "en-GB", name: "en-GB-Neural2-B", ssmlGender: "MALE" },
  },
  "zh-CN": {
    female: { languageCode: "cmn-CN", name: "cmn-CN-Neural2-A", ssmlGender: "FEMALE" },
    male:   { languageCode: "cmn-CN", name: "cmn-CN-Neural2-B", ssmlGender: "MALE" },
  },
  "zh-TW": {
    female: { languageCode: "cmn-TW", name: "cmn-TW-Wavenet-A", ssmlGender: "FEMALE" },
    male:   { languageCode: "cmn-TW", name: "cmn-TW-Wavenet-B", ssmlGender: "MALE" },
  },
};

const DEFAULT_VOICE = VOICES["en-US"];

export async function POST(req: NextRequest) {
  try {
    const { text, gender = "female", dialect = "en-US" } = (await req.json()) as {
      text: string;
      gender?: string;
      dialect?: string;
    };

    if (!text?.trim()) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_TTS_API_KEY ?? "";
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_TTS_API_KEY not set" }, { status: 502 });
    }

    const voiceMap = VOICES[dialect] ?? DEFAULT_VOICE;
    const voice = voiceMap[gender] ?? voiceMap.female;

    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice,
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate: 0.9,
            pitch: gender === "female" ? 1.0 : -2.0,
          },
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[TTS] Google ${res.status}:`, detail);
      return NextResponse.json({ error: `Google TTS ${res.status}`, detail }, { status: 502 });
    }

    const { audioContent } = (await res.json()) as { audioContent: string };
    const audio = Buffer.from(audioContent, "base64");

    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[TTS] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
