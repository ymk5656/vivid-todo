# Audiveris OMR — Railway 배포 가이드 (방안 A: 동기 포워딩)

음악 악보 이미지를 받아 Audiveris로 OMR 처리 후 MusicXML을 반환하는
FastAPI 서비스를 Railway에 배포한다. music-platform은 `OMR_API_URL` 환경변수로
이 서비스를 호출한다.

```
브라우저 → Vercel(/api/omr route.ts) → Railway(Audiveris) → MusicXML 반환
```

## 사전 준비

- Railway 계정 (https://railway.app)
- 이 디렉토리(`audiveris-omr/`)가 Git 저장소에 푸시되어 있거나, Railway CLI 사용

> **메모리 주의**: Audiveris는 JVM + Tesseract 기반이라 메모리를 많이 쓴다.
> 최소 **2GB RAM** 권장 → Railway **Hobby plan 이상** 필요.
> (무료 Trial 의 512MB로는 복잡한 악보에서 OOM 가능)

---

## 방법 1 — Railway 대시보드 (GitHub 연동)

1. 이 디렉토리를 GitHub 저장소로 푸시
   (모노레포라면 `audiveris-omr/`를 **Root Directory**로 지정).
2. Railway → **New Project → Deploy from GitHub repo** → 해당 repo 선택.
3. Settings → **Root Directory** = `audiveris-omr` (모노레포인 경우).
4. Railway가 `Dockerfile`을 자동 감지해 빌드 (`railway.json`의 설정 사용).
5. 첫 빌드는 Audiveris .deb 다운로드 때문에 수 분 소요. 빌드 로그 확인.
6. Settings → **Networking → Generate Domain** 으로 공개 URL 발급
   → 예: `https://audiveris-omr-production.up.railway.app`

## 방법 2 — Railway CLI

```bash
npm i -g @railway/cli
railway login
cd audiveris-omr
railway init            # 새 프로젝트 생성
railway up              # 현재 디렉토리 Dockerfile 빌드 & 배포
railway domain          # 공개 도메인 발급
```

---

## 배포 검증

```bash
# 헬스체크 (railway.json 의 healthcheckPath 와 동일)
curl https://<your-app>.up.railway.app/health
# → {"status":"ok"}

# 실제 OMR (악보 이미지 한 장)
curl -X POST https://<your-app>.up.railway.app/ \
     -F "file=@sample-score.png"
# → MusicXML 텍스트
```

---

## music-platform 연결

Vercel(또는 music-platform 호스트)의 환경변수에 발급받은 URL을 등록한다.
`route.ts`는 `OMR_API_URL`이 있으면 Audiveris로 포워딩하고, 없으면 Groq로 폴백한다.

```
OMR_API_URL = https://<your-app>.up.railway.app/
```

> 끝에 슬래시(`/`) 포함 — `POST /` 엔드포인트이기 때문.

설정 후 Vercel 재배포(또는 dev 서버 재시작)하면 OMR 요청이 Audiveris로 간다.

---

## 알려진 제약 (방안 A)

- **타임아웃 체인**: OMR 처리에 10~120초 소요. 앞단 Vercel 함수 타임아웃
  (Hobby 10초 / Pro 최대 300초)에 걸리면 복잡한 악보는 끊길 수 있다.
  - 완화: `route.ts` 상단에 `export const maxDuration = 300;` (Vercel Pro 필요)
  - 근본 해결이 필요하면 비동기 잡 큐(방안 B, Supabase) 또는 결과 캐시(방안 C)로 전환.
- **콜드 스타트 없음**: Railway 서비스는 상시 가동(scale-to-zero 아님) → 유휴 시에도 과금.
- **subprocess timeout**: `server.py`의 Audiveris 처리 상한은 120초 (필요 시 조정).
