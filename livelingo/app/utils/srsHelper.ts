export interface SRSItem {
  id: string; // 단어 또는 표현 고유 식별자
  type: "word" | "expression";
  text: string;
  translation: string;
  reading?: string;
  dialect: string;
  
  // SRS Fields
  next_review_at: string; // ISO String
  easiness_factor: number; // 기본값 2.5
  interval_days: number; // 복습 간격 (일)
  repetitions: number; // 성공적 반복 횟수
}

export function calculateSuperMemo2(
  quality: number, // 0~5 (5: 완벽, 4: 조금 생각함, 3: 어려웠음, 2: 틀렸으나 기억남, 1: 모름, 0: 완전 모름)
  oldEasinessFactor: number,
  oldRepetitions: number,
  oldInterval: number
) {
  let easinessFactor = oldEasinessFactor;
  let repetitions = oldRepetitions;
  let interval = oldInterval;

  if (quality >= 3) {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easinessFactor);
    }
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 1;
  }

  easinessFactor =
    easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  
  if (easinessFactor < 1.3) {
    easinessFactor = 1.3;
  }

  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);

  return {
    interval_days: interval,
    repetitions,
    easiness_factor: easinessFactor,
    next_review_at: nextReviewDate.toISOString(),
  };
}

export function getDueItems(items: SRSItem[]): SRSItem[] {
  const now = new Date();
  return items.filter((item) => new Date(item.next_review_at) <= now);
}
