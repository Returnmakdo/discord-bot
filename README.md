# 🍁 메이플스토리 디스코드 알리미 봇

메이플스토리 공식 홈페이지의 공지사항, 업데이트, 점검, 이벤트 정보를 자동으로 수집하여 디스코드 채널에 알려주는 봇입니다.

## ✨ 주요 기능

### 📢 공지사항 알림

- 🔄 **자동 크롤링**: 설정한 주기마다 메이플 공홈 체크
- 📊 **카테고리 분류**: 업데이트/점검/이벤트/일반 자동 구분
- 🤖 **AI 요약**: Claude AI로 업데이트/이벤트 내용 자동 요약
- 🖼️ **이벤트 이미지**: 이벤트 상세 페이지 이미지를 첨부파일로 전송

### 📈 경험치 조회 (`!경험치`)

- 📊 **경험치 히스토리**: 최근 10일간 경험치 변화 조회
- 📉 **시각화 그래프**: 바 그래프로 경험치율 변화 표시
- 🔢 **상세 정보**: 날짜별 레벨, 경험치율, 획득량
- 📅 **예상 레벨업**: 일평균 획득량 기반 레벨업 날짜 예측

## 📋 사전 준비

### 1. Node.js 설치

- Node.js 18 이상 필요
- https://nodejs.org/

### 2. Discord Bot 생성

#### Discord Developer Portal

1. https://discord.com/developers/applications 접속
2. **New Application** 클릭
3. 봇 이름 입력 (예: 메이플 알리미)

#### Bot 설정

1. 좌측 메뉴에서 **Bot** 클릭
2. **Add Bot** 클릭
3. **Reset Token** 클릭하여 토큰 복사 (나중에 사용)
4. **Privileged Gateway Intents** 섹션:
   - MESSAGE CONTENT INTENT 활성화

#### 서버에 초대

1. 좌측 메뉴에서 **OAuth2 → URL Generator** 클릭
2. **Scopes** 선택:
   - `bot`
3. **Bot Permissions** 선택:
   - Send Messages
   - Embed Links
   - Read Message History
4. 생성된 URL 복사하여 브라우저에서 열기
5. 서버 선택 후 봇 초대

### 3. 채널 ID 가져오기

1. 디스코드 설정 → 고급 → **개발자 모드** 활성화
2. 알림을 받을 채널 우클릭 → **채널 ID 복사**
3. 카테고리별로 다른 채널을 사용하려면 각각 ID 복사

## 🚀 설치 및 실행

### 1. 프로젝트 설정

```bash
# 프로젝트 폴더로 이동
cd maple-discord-bot

# 패키지 설치
npm install
```

### 2. 환경 변수 설정

```bash
# .env 파일 생성
cp .env.example .env
```

`.env` 파일을 열어서 아래 정보 입력:

```env
# Discord Bot Token (필수)
DISCORD_BOT_TOKEN=여기에_봇_토큰_붙여넣기

# 모든 알림을 받을 기본 채널 ID (필수)
CHANNEL_ID_ALL=여기에_채널_ID_붙여넣기

# 카테고리별 채널 (선택 - 비워두면 CHANNEL_ID_ALL로 전송)
CHANNEL_ID_UPDATE=업데이트_전용_채널_ID

# 경험치 조회 명령어 채널 (선택)
CHANNEL_ID_EXP=경험치_조회_채널_ID

# 체크 주기 (밀리초, 기본값: 5분)
CHECK_INTERVAL=300000

# Anthropic API Key
ANTHROPIC_API_KEY=여기에_Anthropic_API_키

# Nexon Open API Key (경험치 조회용)
NEXON_API_KEY=여기에_넥슨_API_키
```

### 3. 봇 실행

```bash
# 일반 실행
npm start

# 개발 모드 (파일 수정 시 자동 재시작)
npm run dev
```

### 4. 성공 확인

봇이 정상적으로 시작되면 디스코드 채널에 다음 메시지가 표시됩니다:

```
✅ 메이플 알리미 봇 시작
메이플스토리 업데이트를 자동으로 알려드립니다!
```

## 📁 프로젝트 구조

```
maple-discord-bot/
├── src/
│   ├── index.js              # 메인 봇 로직 (경험치 조회 포함)
│   ├── services/
│   │   ├── crawler.js        # 메이플 크롤러
│   │   ├── discord.js        # Discord 메시지 발송
│   │   ├── nexonApi.js       # 넥슨 Open API 연동
│   │   └── summarizer.js     # AI 요약 서비스
│   └── utils/
│       ├── database.js       # SQLite 관리
│       └── logger.js         # 로깅 설정
├── data/                     # 데이터베이스 (자동 생성)
├── logs/                     # 로그 파일 (자동 생성)
├── .env                      # 환경 변수
├── .env.example              # 환경 변수 템플릿
└── package.json
```

## 🎨 알림 예시

### 업데이트

```
🔄 v.257 - 나이트 리릴리스 업데이트
카테고리: 업데이트
작성일: 2025.01.21
```

### 점검

```
🔧 정기 점검 안내
카테고리: 점검 공지
작성일: 2025.01.21
```

### 이벤트

```
🎉 신년 출석 체크 이벤트
카테고리: 이벤트
기간: 2025.01.21 ~ 2025.02.21

[이벤트 상세 이미지 첨부]
```

### 경험치 조회

```
!경험치 김막도
```

```
🍁 메이플스토리 경험치 히스토리

김막도 - 루나
01월 13일 : Lv.293 85.103%
01월 14일 : Lv.293 87.396% (+8.9조)
01월 15일 : Lv.294 0.656% (+52.2조)
...

📊 일일 평균 획득량: 15.7조
📦 남은 경험치량: 394.9조
📅 예상 레벨업 날짜: 26년 02월 14일 (26일 후)

[경험치 그래프 이미지]
```

## ⚙️ 고급 설정

### 체크 주기 변경

`.env` 파일에서 `CHECK_INTERVAL` 값 수정 (밀리초 단위):

```env
CHECK_INTERVAL=180000  # 3분
CHECK_INTERVAL=300000  # 5분 (기본값)
CHECK_INTERVAL=600000  # 10분
```

### 카테고리별 채널 분리

각 카테고리를 다른 채널로 보내려면:

1. 디스코드에서 카테고리별 채널 생성
2. 각 채널의 ID 복사
3. `.env` 파일에 입력

### Railway 배포

```bash
# Railway CLI 배포
railway up -s "쌀숭이서버"
```

### PM2로 백그라운드 실행

```bash
# PM2 설치
npm install -g pm2

# 봇 실행
pm2 start src/index.js --name maple-bot

# 자동 재시작 설정
pm2 startup
pm2 save

# 상태 확인
pm2 status

# 로그 확인
pm2 logs maple-bot

# 중지
pm2 stop maple-bot

# 재시작
pm2 restart maple-bot
```

## 🐛 문제 해결

### 봇이 메시지를 보내지 않아요

1. 봇이 채널에 접근 권한이 있는지 확인
2. `.env` 파일의 채널 ID가 정확한지 확인
3. `logs/error.log` 파일 확인

### "Cannot find module" 에러

```bash
# node_modules 재설치
rm -rf node_modules
npm install
```

### 크롤링 실패

- 넥슨 홈페이지가 일시적으로 다운되었을 수 있습니다
- 봇은 자동으로 재시도합니다
- 지속적으로 실패하면 logs/error.log 확인

### Discord Rate Limit

- 너무 많은 공지사항이 한 번에 게시될 때 발생
- 봇이 자동으로 1초 간격으로 전송하므로 대기하세요

## 📊 데이터베이스 관리

### 데이터 확인

```bash
# SQLite CLI로 접속
sqlite3 data/notices.db

# 최근 공지 10개 조회
SELECT * FROM notices ORDER BY posted_at DESC LIMIT 10;

# 카테고리별 개수
SELECT category, COUNT(*) FROM notices GROUP BY category;

# 종료
.quit
```

### 데이터 초기화

```bash
rm data/notices.db
```

봇 재시작 시 새로운 DB가 생성됩니다.

## 📝 로그 확인

```bash
# 전체 로그
tail -f logs/combined.log

# 에러만
tail -f logs/error.log

# 콘솔 출력 (실행 중)
npm start
```

## 🤝 기여

버그 리포트나 기능 제안은 이슈로 남겨주세요!

## 📄 라이센스

MIT License

## ⚠️ 주의사항

- 이 봇은 메이플스토리 공식 홈페이지를 크롤링합니다
- 과도한 요청으로 서버에 부담을 주지 않도록 체크 주기를 5분 이상으로 설정하세요
- 개인 서버 용도로만 사용하세요
- 봇 토큰은 절대 공개하지 마세요

## 🔧 업데이트 로그

### v1.3.1 (2026.01.23)

- 🐛 경험치 조회 에러 시 메시지 중복 발송 수정
- ⚡ Nexon API 요청 간격 증가 (초당 rate limit 방지)

### v1.3.0 (2026.01.23)

- 🖼️ 이벤트 크롤링 개선 (제목/기간/이미지 정상 추출)
- 📎 이벤트 상세 이미지를 첨부파일로 전송
- 📅 이벤트 날짜 필드 '작성일' → '기간'으로 변경
- 🤖 이미지만 있는 이벤트 / 이미지+글 이벤트 분기 처리

### v1.2.0 (2025.01.23)

- 🆕 경험치 조회 기능 추가 (`!경험치 닉네임`)
- 📊 경험치 히스토리 바 그래프 시각화
- 📅 예상 레벨업 날짜 계산
- 🔢 자동 단위 변환 (만/억/조/경)

### v1.1.0 (2025.01.22)

- 🤖 AI 요약 기능 추가 (Claude API)
- 📰 이벤트 페이지 크롤링 추가

### v1.0.0 (2025.01.21)

- 초기 릴리스
- 기본 크롤링 및 알림 기능
- 카테고리 자동 분류
- SQLite 중복 방지
- 재시도 로직
- 로깅 시스템
