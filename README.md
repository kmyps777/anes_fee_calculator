# 마취비 계산기

마취과 업무용 비용 계산 웹앱. GitHub Pages에서 호스팅하며 사파리 PWA로 홈 화면에 추가해 사용합니다.

---

## 파일 구성

```
├── index.html   — 앱 진입점 · Firebase config 위치
├── app.js       — 계산 로직 · Firebase CRUD · UI 제어
├── style.css    — 스타일 (Clinical Minimal Dark)
├── manifest.json — PWA 메타 (직접 생성 필요, 아래 참고)
└── README.md
```

---

## Firebase 설정 방법

### 1. Firebase 프로젝트 생성
1. [Firebase 콘솔](https://console.firebase.google.com/) → **프로젝트 추가**
2. **Firestore Database** → 데이터베이스 만들기 → **프로덕션 모드** 선택
3. **프로젝트 설정** → **내 앱** → 웹 앱 추가 (`</>`) → 앱 닉네임 입력 후 등록

### 2. Firestore 보안 규칙 설정
Firebase 콘솔 → Firestore → **규칙** 탭에서 아래로 교체:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/records/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

> 로그인한 사용자는 본인 기록만 읽고 쓸 수 있습니다. 비로그인 접근은 차단됩니다.

### 4. Google 로그인 활성화
Firebase 콘솔 → **Authentication** → **Sign-in method** → **Google** → 사용 설정 → 저장

### 5. 승인된 도메인 추가 (필수)
Firebase 콘솔 → **Authentication** → **Settings** → **승인된 도메인** → **도메인 추가**

추가할 도메인:
```
YOUR_USERNAME.github.io
```

> ⚠️ 이 설정을 안 하면 GitHub Pages에서 구글 로그인 팝업이 차단됩니다.

### 6. API 키 도메인 제한 (권장)
Google Cloud Console → **API 및 서비스** → **사용자 인증 정보** → Firebase 프로젝트의 **API 키** 선택 → **애플리케이션 제한사항** → **HTTP 리퍼러** 선택 후 아래 추가:

```
https://YOUR_USERNAME.github.io/*
```

> 이 설정을 하면 내 도메인에서만 API 키가 동작해 무단 사용을 막을 수 있습니다.

### 3. index.html 에 config 붙여넣기
`index.html` 하단 스크립트 블록에서 아래 부분을 수정합니다:

```javascript
const firebaseConfig = {
  apiKey:            "AIza...",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};
```

Firebase 콘솔 → 프로젝트 설정 → 내 앱 → **SDK 설정 및 구성** → **구성** 선택 후 값 복사.

---

## GitHub Pages 배포

```bash
# 저장소 루트에 파일 위치
git init
git add .
git commit -m "init: 마취비 계산기"
git remote add origin https://github.com/YOUR_USERNAME/anesthesia-calculator.git
git push -u origin main
```

GitHub 저장소 → **Settings** → **Pages** → Source: `main` 브랜치 / `/ (root)` → **Save**

배포 URL: `https://YOUR_USERNAME.github.io/anesthesia-calculator/`

---

## PWA 홈 화면 추가 (Safari iOS)

1. Safari에서 앱 URL 접속
2. 하단 **공유** 버튼(□↑) 탭
3. **홈 화면에 추가** 선택
4. 이름 확인 후 **추가**

홈 화면 아이콘으로 실행하면 풀스크린 앱처럼 동작합니다.

### manifest.json 생성 (필수)
프로젝트 루트에 `manifest.json` 파일을 만들어주세요:

```json
{
  "name": "마취비 계산기",
  "short_name": "마취비",
  "description": "마취 수술별 청구 금액 계산기",
  "start_url": "/anesthesia-calculator/",
  "display": "standalone",
  "background_color": "#0a1628",
  "theme_color": "#0a1628",
  "orientation": "portrait",
  "icons": [
    {
      "src": "icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

> 아이콘(icon-192.png, icon-512.png)이 없어도 앱은 작동합니다. Safari는 `apple-touch-icon` 링크를 우선 사용합니다.

---

## 계산 로직 설명

### 기본 요금
- 수술 1건당 기본 **30만원**
- n건이면 기본 **30n만원**, 기본 포함 시간 **n시간**

### 초과 요금
- 유효 마취 시간이 n시간을 초과하면 **15분당 2만원** 추가
- 1분이라도 초과 시 해당 15분 구간 요금 적용 (올림)
  - 예) 5분 초과 → 2만원 / 16분 초과 → 4만원

### 유효 마취 시간 계산 (Interval Union)
- 시작 시간이 입력된 수술은 `[시작, 시작+마취시간]` 구간으로 계산
- **겹치는 구간은 합산하지 않음** (실제로 마취하고 있던 시간만 계산)
- 시작 시간이 없는 수술은 독립 시간으로 합산

#### 예시
| 케이스 | 시작 | 마취 시간 | 유효 구간 |
|--------|------|-----------|-----------|
| 수술 1 | 1:00 | 60분      | 1:00–2:00 |
| 수술 2 | 1:05 | 120분     | 1:05–3:05 |
| 합산   | —    | —         | 1:00–3:05 = **125분** |

3건 → 기본 3시간(180분) > 125분 → 초과 없음 → 기본비 3×30 = **90만원** ✗  
2건 → 기본 2시간(120분) < 125분 → 초과 5분 → 1구간 → 2만원 추가 → **62만원** ✓

### 응급 가산
- 해당 수술에 체크 시 **+3만원** (건당)
- 전체 합계에 합산됨

### 수술별 분배
- 기본 30만원 + 초과비(각 수술의 마취 시간 비율로 배분) + 응급 가산

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 수술 추가/삭제 | 동적으로 케이스 카드 추가 |
| 마취 시작 시간 | time picker (선택) — 겹치는 시간 자동 계산 |
| 마취 시간 | 시간 + 분 분리 입력 |
| 응급 가산 | 케이스별 체크박스 |
| 계산 결과 | 전체 합계 · 타임라인 요약 · 수술별 상세 분해 |
| Firebase 저장 | 계산 결과 Firestore 저장/조회/삭제 |
| 기록 드로어 | 저장된 기록 목록 슬라이드 패널 |
| PWA | 사파리 홈 화면 추가, 전체화면 독립 앱 |

---

## Firebase 없이 사용하기
`firebaseConfig`를 수정하지 않아도 계산 기능은 정상 작동합니다.  
저장 시 "Firebase 미연결" 토스트가 표시되며, 기록 저장만 불가합니다.
