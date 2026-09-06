# deploy/ -- 컨테이너 스택 (브로커 · 시뮬레이터 · 로봇 스택 · 대시보드)

Fleet Studio 는 두 부분으로 뜬다.

| 어디서 | 무엇 | 명령 |
|---|---|---|
| 호스트 | Vite(:3000) · API(:3001) · Go 플래너(:3002) · scan-engine(:8000) | `npm run dev` |
| Docker(공유 인프라) | mosquitto(:1883/9001) · dashboard(:5173) · signaling(:9770) | `npm run stack:up` |
| Docker(현장별) | simulator + sim-driver ×2 (포트는 현장마다 자동 배정) | 설정 › 시뮬레이터 카드 |

```bash
cp deploy/.env.example deploy/.env   # STACK_TAG 등
npm run stack:up                     # GHCR 에서 이미지를 받아온다 -- simulator/robot-os-chromium 체크아웃 불필요
npm run stack:logs
npm run stack:down
```

- **`docker-compose.yml`(기본, 공유 인프라)**: `ghcr.io/dcrobot-keen/fleet-studio-stack`를 pull 만 한다. 소스
  저장소가 필요 없다. 이미지는 `.github/workflows/stack-image.yml`이 `robot-os-chromium`·`simulator` 두 저장소로부터
  빌드해 push 한다(그 저장소에 push 될 때마다 갱신 -- 최신을 받으려면 `npm run stack:pull && npm run stack:up`).
- **`docker-compose.dev.yml`(소스를 직접 고칠 때, 공유 인프라)**: 같은 세 서비스를 `ROS_CHROMIUM_DIR`(기본
  `../../ros-chromium`) 체크아웃에서 바인드 마운트해 빌드한다. `npm run stack:dev:up` / `stack:dev:down` /
  `stack:dev:logs` / `stack:dev:build`.
- **시뮬레이터는 현장(설정 › 시뮬레이터 카드)에서 켜고 끈다** -- `server/simControl.mjs`가 현장마다 별도 compose
  프로젝트(`-p fs-sim-<현장 id>`)로 띄운다. 기본은 `deploy/docker-compose.site.yml`(GHCR 이미지 pull); 서버 실행
  환경변수 `SIM_STACK_MODE=prod`가 그 반대(소스 빌드)다 -- 이 저장소를 개발 중인 환경(`ROS_CHROMIUM_DIR` 체크아웃이
  있는 곳)에서는 `SIM_STACK_MODE`를 안 주면 기본이 소스 빌드형(`docker-compose.site.dev.yml`)이고, 소스 저장소가
  없는 보통 환경(Mac 등, GHCR 이미지만 받는 경우)은 `SIM_STACK_MODE=prod`를 pathfinder API 실행 환경에 설정해
  pull 형을 쓰게 한다. 여러 현장을 **동시에** 띄울 수 있다: 현장마다 포트 베이스를 하나씩 배정해(8765, 8865,
  8965, ... `data/sim-config.json`에 저장, 재시작해도 유지) 시뮬레이터의 호스트 포트 5개(로봇 0/1 소켓 + 뷰어)가
  안 겹치게 한다. sim-driver 는 브로커(mosquitto)를 hostname 대신 `host.docker.internal:1883`로 찾는다 -- 현장별
  compose 프로젝트가 서로 다른 도커 네트워크에 있어서다(pathfinder API를 `host.docker.internal:3001`로 찾는 것과
  같은 방식). 로봇 id가 다른 현장과 겹치면(같은 브로커를 쓰므로) 시작을 거절한다.
- `worlds/`: 시뮬레이터가 읽는 월드 파일. 데모 월드(room/maze/corridor/...)는 커밋되어 있고, 정합 워크스페이스에서
  저장하면 scan-engine 이 여기(`STUDIO_PUBLISH_DIR=../deploy/worlds`)에 `<group>.slicemap.json`/`.floor.png`를
  다시 쓴다 -- 그 현장의 시뮬레이터를 설정 › 시뮬레이터 카드에서 다시 시작하면 새 월드를 읽는다.
- sim-driver 는 호스트의 pathfinder API 에도 `host.docker.internal:3001` 로 붙는다 (Docker Desktop Mac/Windows 기본 제공, Linux 는 host-gateway 설정 포함).
