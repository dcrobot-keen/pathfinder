# deploy/ -- 컨테이너 스택 (브로커 · 시뮬레이터 · 로봇 스택 · 대시보드)

Fleet Studio 는 두 부분으로 뜬다.

| 어디서 | 무엇 | 명령 |
|---|---|---|
| 호스트 | Vite(:3000) · API(:3001) · Go 플래너(:3002) · scan-engine(:8000) | `npm run dev` |
| Docker | mosquitto(:1883/9001) · simulator(:8765-8767, 8775/8776) · sim-driver ×2 · dashboard(:5173) · signaling(:9770) | `npm run stack:up` |

```bash
cp deploy/.env.example deploy/.env   # SIM_WORLD · SIM_ROBOTS
npm run stack:up                     # GHCR 에서 이미지를 받아온다 -- simulator/robot-os-chromium 체크아웃 불필요
npm run stack:logs
npm run stack:down
```

- **`docker-compose.yml`(기본)**: `ghcr.io/dcrobot-keen/fleet-studio-stack`를 pull 만 한다. 소스 저장소가 필요 없다.
  이미지는 `.github/workflows/stack-image.yml`이 `robot-os-chromium`·`simulator` 두 저장소로부터 빌드해 push 한다
  (그 저장소에 push 될 때마다 갱신 -- 최신을 받으려면 `npm run stack:pull && npm run stack:up`).
- **`docker-compose.dev.yml`(소스를 직접 고칠 때)**: `ROS_CHROMIUM_DIR`(기본 `../../ros-chromium`) 아래의
  `robot-os-chromium/`·`simulator/` 체크아웃을 바인드 마운트해 그 자리에서 빌드한다. `npm run stack:dev:up` /
  `stack:dev:down` / `stack:dev:logs` / `stack:dev:build`. 두 compose 는 `name: fleet-studio`로 프로젝트가 같으니
  전환 전에 `npm run stack:down`(또는 `stack:dev:down`)으로 먼저 내릴 것.
- `worlds/`: 시뮬레이터가 읽는 월드 파일. 데모 월드(room/maze/corridor/...)는 커밋되어 있고, 정합 워크스페이스에서
  저장하면 scan-engine 이 여기(`STUDIO_PUBLISH_DIR=../deploy/worlds`)에 `<group>.slicemap.json`/`.floor.png`를
  다시 쓴다 → `docker compose ... restart simulator sim-driver sim-driver-2`로 새 월드를 읽는다.
- sim-driver 는 호스트의 API 에 `host.docker.internal:3001` 로 붙는다 (Docker Desktop Mac/Windows 기본 제공, Linux 는 host-gateway 설정 포함).
