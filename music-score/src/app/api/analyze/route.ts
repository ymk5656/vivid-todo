import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';

export interface AnalysisResult {
  key: string;
  timeSignature: string;
  difficulty: '초급' | '중급' | '고급';
  mood: string;
  summary: string;
  learningPoints: string[];
  chordProgression: string[];
  dangerZones: Array<{ measureStart: number; measureEnd: number; reason: string }>;
}

export async function POST(req: NextRequest) {
  const { xmlUrl, title, composer } = await req.json();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.startsWith('your_')) {
    return NextResponse.json(
      { error: 'GROQ_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요.' },
      { status: 503 }
    );
  }

  let xmlText = '';
  try {
    const absoluteUrl = xmlUrl.startsWith('/')
      ? `${req.nextUrl.origin}${xmlUrl}`
      : xmlUrl;
    const res = await fetch(absoluteUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xmlText = await res.text();
    if (xmlText.length > 24000) xmlText = xmlText.slice(0, 24000);
  } catch (e) {
    return NextResponse.json(
      { error: `악보 파일 로드 실패: ${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }

  const client = new Groq({ apiKey });

  const prompt = `다음 MusicXML 악보를 분석해주세요.
제목: ${title}
작곡가: ${composer ?? '알 수 없음'}

MusicXML 내용:
${xmlText}

반드시 아래 JSON 형식으로만 응답하세요. 마크다운 코드 블록 없이 순수 JSON만 출력하세요.
{
  "key": "조성 (예: C장조, A단조, G장조)",
  "timeSignature": "박자 (예: 4/4, 3/4, 6/8)",
  "difficulty": "난이도 — 초급, 중급, 고급 중 하나만",
  "mood": "분위기 한 줄 (예: 밝고 경쾌함, 서정적이고 부드러움)",
  "summary": "이 곡의 특징과 음악적 의미를 2-3문장으로 설명",
  "learningPoints": ["연습 포인트 1", "연습 포인트 2", "연습 포인트 3"],
  "chordProgression": ["마디별 또는 섹션별 주요 화음을 배열로 나열. 예: I, IV, V7, I"],
  "dangerZones": [
    {
      "measureStart": 마디 시작 번호(정수),
      "measureEnd": 마디 끝 번호(정수),
      "reason": "어려운 이유 설명 (예: 큰 도약 음정, 빠른 반음계 진행, 복잡한 리듬)"
    }
  ]
}`;

  try {
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1536,
      messages: [
        {
          role: 'system',
          content: '당신은 음악 분석 전문가입니다. 모든 응답은 반드시 한국어로만 작성하세요. 일본어, 중국어 한자, 기타 비한국어 문자를 절대 사용하지 마세요.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const raw = completion.choices[0].message.content?.trim() ?? '';
    const jsonText = raw.startsWith('{') ? raw : raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
    const analysis: AnalysisResult = JSON.parse(jsonText);
    if (!analysis.chordProgression) analysis.chordProgression = [];
    if (!analysis.dangerZones) analysis.dangerZones = [];
    return NextResponse.json(analysis);
  } catch (e) {
    return NextResponse.json(
      { error: `AI 분석 실패: ${e instanceof Error ? e.message : e}` },
      { status: 500 }
    );
  }
}
