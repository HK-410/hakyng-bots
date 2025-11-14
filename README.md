# hakyng-x-bots

재미있는 X(트위터) 봇을 개발하고 있습니다.

이 프로젝트는 `pnpm` 워크스페이스를 사용하는 모노레포로 구성되어 있습니다.

- `core`: 트윗 봇이 작동하는 NextJs 기반 메인 서버입니다.
  - 봇 로직은 `core/src/lib/bots` 디렉토리 아래에 각 봇별로 모듈화되어 있습니다 (`githyung`, `nanal`, `weatherfairy`).
- `packages/x-bot-toolkit`: 여러 봇에서 재사용 가능한 유틸리티 및 API 클라이언트 라이브러리입니다.
  - **Groq Client**: Groq (LLM) API와 연동하여 콘텐츠를 생성합니다.
  - **Twitter Client**: Twitter API v2와 연동하여 트윗 스레드를 게시합니다.

## 시작하기

### 사전 준비

- Node.js (v22 권장)

### 설치

프로젝트 루트 디렉토리에서 아래 명령어를 실행하여 모든 의존성을 설치합니다.

```bash
pnpm install
```

### 환경변수 설정

각 앱이 동작하려면 API 키 등의 비밀 정보가 필요합니다. (`core` 앱을 예시로 설명하겠습니다.)

1.  `core` 디렉토리로 이동합니다.
2.  `.env.sample` 파일을 복사하여 `.env` 파일을 생성합니다.

    ```bash
    cp ./.env.sample ./.env
    ```
3.  생성된 `.env` 파일을 열어 실제 키로 채워넣습니다.

### 빌드

공유 라이브러리인 `x-bot-toolkit`을 사용하기 전에 반드시 빌드해야 합니다. 프로젝트 루트에서 아래 명령어를 실행하세요.

```bash
pnpm --filter "@hakyung/x-bot-toolkit" run build
```

## 로컬 개발

로컬 최초 실행시에는 link가 필요합니다.

```bash
vercel link
```

Vercel Project 설정의 `Root Directory`는 `core`로 설정되어야 합니다.

이후, 아래 명령어를 실행하여 Vercel 개발 서버를 시작합니다.

```bash
vercel dev
```

서버가 시작되면 `http://localhost:3000` 주소로 접속할 수 있습니다.

## 개발 컨벤션

이 프로젝트는 코드 품질과 일관성을 유지하기 위해 Git 훅을 사용합니다.

-   **Husky**: Git 훅을 관리합니다.
-   **lint-staged**: 스테이징된 파일에 대해서만 린트 검사를 실행합니다.
-   **commitlint**: 커밋 메시지 컨벤션을 검증합니다.

### Git 훅

-   `pre-commit`: 커밋 전에 스테이징된 파일에 대해 ESLint 검사를 실행합니다.
-   `commit-msg`: 커밋 메시지가 Conventional Commits 사양을 따르는지 검증합니다.

## 테스트

앱 디렉토리 안에는 테스트용 쉘 스크립트가 포함되어 있습니다.

-   **Dry Run (트윗하지 않고 내용만 생성)**

    ```bash
    sh core/test_dryrun.sh
    ```

-   **실제 트윗 발행**

    ```bash
    sh core/test_tweet.sh
    ```

### Jest 설정

Jest 테스트 환경에서 `groq-sdk` 모듈을 올바르게 해석하지 못하는 문제를 해결하기 위해 `core/jest.config.js` 파일에 `moduleNameMapper` 워크어라운드가 적용되어 있습니다. 이는 `pnpm`의 모듈 구조와 Jest의 `exports` 필드 해석 문제로 인한 것으로, `groq-sdk` 버전 변경 시 업데이트가 필요할 수 있습니다.

## 배포

이 프로젝트는 Vercel에 배포됩니다. `core` 디렉토리 내부의 `vercel.json` 파일에 정의된 cron 스케줄에 따라 매일 지정된 시간에 자동으로 운세를 생성하고 트윗합니다.

