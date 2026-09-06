# deploy/ -- 컨테이너 스택 (브로커 · 시뮬레이터 · 로봇 스택 · 대시보드)

Fleet Studio 는 두 부분으로 뜬다.

| 어디서 | 무엇 | 명령 |
|---|---|---|
| 호스트 | Vite(:3000) · API(:3001) · Go 플래너(:3002) · scan-engine(:8000) | `npm run dev` |
| Docker | mosquitto(:1883/9001) · simulator(:8765-8767, 8775/8776) · sim-driver ×2 · dashboard(:5173) · signaling(:9770) | `npm run stack:up` |

```bash
cp deploy/.env.example deploy/.env   # ROS_CHROMIUM_DIR · SIM_WORLD · SIM_ROBOTS
npm run stack:up                     # 처음엔 이미지를 만든다 (node:22-alpine + npm ci 두 번)
npm run stack:logs
npm run stack:down
```

- `ROS_CHROMIUM_DIR` 아래에 `robot-os-chromium/`(dcrobot-keen/robot-os-chromium) 와 `simulator/`(dcrobot-keen/simulator) 체크아웃이 있어야 한다.
  기본값 `../../ros-chromium` = 워크스페이스 루트의 `ros-chromium/` 폴더.
- 소스는 바인드 마운트: 코드 수정은 `docker compose -f deploy/docker-compose.yml restart simulator` 로 반영. package.json 이 바뀌면 `npm run stack:build`.
- sim-driver 는 호스트의 API 에 `host.docker.internal:3001` 로 붙는다 (Docker Desktop Mac/Windows 기본 제공, Linux 는 host-gateway 설정 포함).
- 정합을 저장하면 scan-engine 이 `SIM_WORLD` 슬라이스맵을 `simulator/worlds/` 에 다시 쓴다 → `docker compose ... restart simulator sim-driver sim-driver-2` 로 새 월드를 읽는다.
