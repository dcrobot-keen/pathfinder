# Fleet Studio (Robot Orchestration Toolchain)

아이폰 라이다로 스캔한 컬러드 포인트 클라우드(PCD)와 슬라이스맵을 기반으로 실내 지도를 구성하고,
그 위에서 노드/링크/장애물 편집, 다중 로봇 충돌회피(deconfliction), 산업 표준 VDA5050 기반 플릿 관제(RCS),
그리고 로봇 모델 카탈로그와 실제 배속 기기 관리를 통합 제공하는 웹 기반 실내 로봇 오케스트레이션 스튜디오입니다.

## 기술 스택

- [Vite](https://vitejs.dev/) + 순수 JavaScript (ES Modules, Vanilla UI)
- [OpenLayers](https://openlayers.org/) — 2D 지도 (m 단위 직교 평면 좌표계, 다중 레이어 합성)
- [Three.js](https://threejs.org/) — 3D orbit 뷰 (LiDAR 점군 / 마칭 큐브 메쉬) + 시뮬레이터 3D 뷰어 임베드
- [Express](https://expressjs.com/) + [lowdb](https://github.com/typicode/lowdb) — 프로젝트/노드링크/로봇모델/기기/VDA5050 REST & WebSocket API 서버
- Go (표준 라이브러리) — 경로탐색 알고리즘(Dijkstra/A*/Grid A*/Hybrid A*) HTTP API + WASM 빌드
- [mqtt](https://github.com/mqttjs/MQTT.js) — VDA5050 2.0 MQTT 브로커(mosquitto) 통신 브리지
- [ws](https://github.com/websockets/ws) — 실시간 로봇 위치 및 플릿 이벤트 WebSocket 브로드캐스트

## 실행

```bash
npm install
npm run dev              # Vite(3000) + lowdb API(3001) + Go pathfinder API(3002) 동시 실행
npm run build            # 프로덕션 번들 빌드 (dist/)
npm test                 # JS 자동 스모크 테스트 6종 전체 실행
npm run test:pathfinder  # Go 경로탐색 알고리즘 테스트 (33개 케이스)
```

`npm run dev`는 `concurrently`로 세 프로세스를 함께 띄웁니다. 개별 실행은
`dev:client` / `dev:server` / `dev:pathfinder`를 사용하세요. Go 툴체인이 PATH에
있어야 `dev:pathfinder`가 동작합니다 (`go version`으로 확인).

## 정보 구조 (Information Architecture, IA) & 2단 메뉴

Fleet Studio는 2단 헤더 구조(Tier 1 GNB + Tier 2 Contextual Subnav)로 설계되어 있습니다:

- **Level 0 (Site / Map Scope)**: 헤더 최좌측의 현장 셀렉터(`📍 현장: default [승인]`, `+ 새 현장`, `+ 스캔 지도`). 어떤 워크스페이스에 있든 작업 기준이 되는 현장(좌표 평면 및 맵 데이터)을 즉시 전환.
- **Level 1 (5 Core Workspaces)**:
  1. **`지도 (Maps)`**: 2D 지도 편집(노드/링크/장애물), 3D 점군/메쉬 뷰어, 정합 스튜디오(:8000) 연동.
  2. **`로봇 (Robots)`**: 플릿 모니터링(`Fleet`) 및 하드웨어 사양 템플릿과 기기 배속 관리(`Catalog`).
  3. **`운영 (Operate)`**: 지도 기반 경로 계획, VDA5050 이동 명령(Order) 발행, 다중 로봇 충돌회피(Deconfliction).
  4. **`시뮬레이션 (Simulation)`**: 시뮬레이터 3D 뷰어(:8767/:8777) 임베드 및 가상 로봇 주행 검증.
  5. **`설정 (Settings)`**: VDA5050 MQTT 브로커 연결 설정 및 시스템 환경 구성.
- **Tier 2 (Contextual Subnav)**: 선택된 워크스페이스에 따라 서브 탭(2D, 3D, 정합 스튜디오 링크, Fleet, Catalog 등)과 관련 툴버튼(`📥 PCD 업로드`)이 표시됩니다.
- **실시간 GNB 텔레메트리**: 헤더 우측에 `● MQTT 온라인 (1883)`, `🤖 N대 온라인` 배지가 상시 노출되어 연결 상태를 즉각 파악 가능.

## 기능 개요

1. **2D 지도 & 직교 평면 좌표계** — 원점(0,0) 기점 m 단위 평면 좌표계 위에 격자 표시. 배경 도면(blueprint) 및 앱 스캔 바닥 이미지(`*.floor.png`) 레이어 오버레이.
2. **3D 컬러드 PCD & 메쉬** — ASCII/바이너리 PCD 파싱 후 `WebGLVectorLayer`로 실제 RGB 색상 표시, 마칭 큐브(Marching Cubes) 등위면 추출을 통한 3D 메쉬(PLY) 생성.
3. **높이 슬라이스 & 레이어 패널** — z 높이 50cm 단위 레이어 슬라이싱 및 개별 on/off.
4. **노드/링크/블록 편집기** — 2D 지도 위에서 노드(Point), 링크(LineString), 블록(Polygon) 그리기/수정/삭제. 프로젝트별 GeoJSON으로 영속화.
5. **스캔 장애물 연동 (scan-to-map-studio)** — LiDAR 스캔에서 추출된 가구/벽 세그먼트를 `kind: "block"` 장애물로 불러와 수동 편집 레이어와 자동 결합.
6. **슬라이스맵 기반 프로젝트 자동 생성** — 정합 워크스페이스가 생성한 `<group>.slicemap.json`과 바닥 이미지를 단 한 번의 클릭 또는 CLI로 새 현장 프로젝트로 변환.
7. **장애물 회피 경로탐색 (Go 백엔드 & WASM)** — Occupancy grid 위에서 Grid A* 또는 Hybrid A*(연속 좌표+조향 고려) 경로 탐색. 대형 부지에서도 국소 영역 탐색(local bounds) 및 적응형 해상도로 고속 응답.
8. **클라이언트 사이드 Deconfliction** — 다중 로봇 동시 주행 시 200ms 주기로 미래 lookahead 구간 내 충돌 감지. 우선순위 드래그앤드롭 조정 및 일시정지(pause & resume) 또는 실시간 재탐색(re-routing).
9. **로봇 모델 카탈로그 (Catalog) & 기기 등록 (Fleet Devices)** — 하드웨어 사양 템플릿(카탈로그)과 실제 물리/가상 로봇 기기 인스턴스를 분리 관리.
10. **VDA5050 2.0 표준 플릿 관제 (RCS)** — MQTT 브로커를 통한 양방향 통신. `connection`/`state`/`visualization` 구독, 이동 주문(`order`) 및 즉시 제어(`cancelOrder`, `startPause`, `stopPause`), 주문 진행률 바, 최근 주문 이력 및 이벤트 타임라인 영속화.

## 프로젝트 구조

```
index.html             2단 IA 헤더(GNB + Contextual Subnav), 5대 워크스페이스 뷰 컨테이너
vite.config.js          /api/path -> Go(3002), /api -> Express(3001) 프록시
src/
  main.js               앱 진입점, 워크스페이스 탭 전환 오케스트레이션, GNB 텔레메트리
  appShared.js            프로젝트별 직교 좌표계 및 공유 VectorSource (탭 간 상태 공유)
  grid2d.js                재사용 가능한 m 단위 격자 레이어
  nodeLinkStyle.js          노드/링크/블록 공통 스타일
  pcd.js                 PCD 파서 (ASCII/바이너리, FIELDS x y z rgb)
  heightSlices.js        z 높이 슬라이스 레이어 생성 + 레이어 패널 UI
  meshify.js             점군 -> 복셀 밀도 필드 -> 마칭 큐브 메쉬 변환
  ply.js                 메쉬 -> ASCII PLY 직렬화
  view3d.js               Three.js 3D 점군/메쉬 뷰어
  editLayer.js            노드/링크/블록 대화형 그리기·수정 툴바
  geojsonApi.js            프로젝트 스코프 GeoJSON CRUD API 클라이언트
  importedObstacles.js     스캔 장애물 패널 및 스타일
  livePoseTransform.js     scan_basemap <-> map 좌표 역/정변환 (순수 함수)
  liveRobotPose.js         실시간 위치 구독 및 지도 마커 렌더링
  pathfinding/
    tab.js                 길찾기 & Deconfliction & VDA5050 실제 이동 명령 뷰
    pathfindingApi.js        Go pathfinder API 클라이언트
    robotAnimation.js        경로 주행 애니메이션 및 마커 스타일
  robots/
    robotRegistry.js         Fleet 관제 뷰 & 로봇 모델 카탈로그/기기 등록 UI
    robotApi.js               로봇 기기 및 모델 카탈로그 API 클라이언트
    robotCodes.js              타입/알고리즘/상태 라벨 매핑
  projects/
    projectApi.js            프로젝트 CRUD 및 slicemap 임포트 API 클라이언트
    projectSelector.js       GNB Level 0 현장 선택기 컴포넌트
  style.css               Fleet Studio 통합 스타일 (2단 헤더, 반응형 레이아웃, 다크 테마)
shared/
  robotIcons.mjs           로봇 모델별 기본 SVG 아이콘 (서버 시드 및 프론트엔드 공용)
server/
  index.mjs               Express API 서버 진입점 (프로젝트, 로봇, 카탈로그, VDA5050 마운트)
  projects.mjs            현장(Project) CRUD API (`/api/projects`) 및 slicemap 변환기
  robotModels.mjs         로봇 모델 카탈로그 CRUD API (`/api/robot-models`)
  robots.mjs                로봇 기기 CRUD API (`/api/robots`) + modelId 데코레이터
  vda5050.mjs               VDA5050 2.0 MQTT 브리지 (`/api/vda5050/*`) 및 WebSocket 릴레이
  slicemap.mjs            slicemap-v1 -> GeoJSON 및 메타데이터 변환 파서
pathfinder/               Go 모듈 — 경로탐색 알고리즘 + HTTP API + WASM
  graph/                   Dijkstra/A*, 그래프 스냅
  grid/                    Occupancy grid, Grid A*, Hybrid A*
  server/                  Go HTTP 서버 (`/api/path/nodelink`, `/api/path/obstacle`)
  wasm/                    grid 패키지 WASM 빌드 (`pathfinderFindPath`)
scripts/
  live-pose-smoke.mjs      좌표 역변환 및 실시간 위치 릴레이 스모크 테스트
  projects-smoke.mjs       프로젝트 격리 및 CRUD 스모크 테스트
  scan-alignment-smoke.mjs 정합 transform 계산 스모크 테스트
  vda5050-smoke.mjs        VDA5050 MQTT 브리지 스모크 테스트
  scan-project-smoke.mjs   slicemap 프로젝트 생성 스모크 테스트
  robot-models-smoke.mjs   로봇 모델 카탈로그 CRUD & 기기 데코레이터 스모크 테스트
  build-wasm.mjs           Go WASM 컴파일 빌드 스크립트
data/
  projects.json            현장(Project) 메타데이터 목록
  robot-models.json        로봇 모델 하드웨어 사양 카탈로그
  robots.json              배속된 로봇 기기 인스턴스 (modelId 참조)
  vda5050.json             VDA5050 브로커 설정, 최근 주문, 이벤트 타임라인
  nodelink.geojson         기본 현장 노드/링크/블록 데이터
  projects/<id>/           개별 현장별 독립 nodelink.geojson
```

## 경로탐색 API (Go)

```bash
# 노드/링크 그래프 위 탐색 (algorithm: dijkstra | astar)
POST /api/path/nodelink   { featureCollection, start: {x,y}, end: {x,y}, algorithm }

# block(폴리곤) 장애물만 피하는 자유공간 탐색 (algorithm: gridastar | hybridastar)
POST /api/path/obstacle   { featureCollection, start: {x,y}, end: {x,y}, algorithm, cellSize }

# 응답: { path: [[x,y], ...], distance, algorithm }
```

## WASM 빌드 (서버 없이 브라우저에서 직접 경로탐색)

```bash
npm run build:wasm   # dist-wasm/pathfinder.wasm + wasm_exec.js 생성 (git에는 커밋 안 함)
```

`pathfinder/wasm`가 `grid` 패키지(`GridAStar`/`HybridAStar`)를 `pathfinderFindPath(request)` 전역 함수 하나로 노출합니다. 재구현이 아니라 실제 `grid` 패키지를 그대로 컴파일한 것이라, 이 패키지의 Go 테스트가 통과하면 WASM 빌드도 같은 로직으로 동작한다고 볼 수 있습니다(2026-08-29 기준 Node/V8에서 5개 시나리오로 직접 검증 — 열린 공간/벽 우회/Hybrid A*/완전히 막힌 목적지, 200x200 격자에서 호출당 평균 1.7ms).

```js
// request 형태 (blocks 대신 occupied를 주면 폴리곤 래스터화를 건너뛰고 비트맵을 바로 씀 -- LIDAR로
// 누적한 costmap처럼 이미 셀 단위 점유 정보가 있는 호출자에게 더 자연스러움)
{
  originX, originY, cellSize, cols, rows,
  occupied?: (boolean[] | Uint8Array),  // row-major, length cols*rows
  blocks?: [[[x, y], ...], ...],        // occupied가 없을 때만 사용, GeoJSON 폴리곤 링
  start: { x, y }, goal: { x, y },
  algorithm: "gridastar" | "hybridastar",
}
// 응답: { path: [[x,y], ...], distance } | { error }
```

첫 소비자는 [ros-chromium](../ros-chromium)/robot-os-chromium의 `packages/planner-wasm` + `PlannerNode`입니다 — roadmap.md Phase 7("PlannerNode — 격자 A*")을 새로 구현하는 대신 이 빌드를 그대로 가져다 씁니다. 자세한 배경은 [`../doc/architecture-improvements.md`](../doc/architecture-improvements.md) 참고.

## 로봇 모델 카탈로그 & 기기 등록 API

Fleet Studio는 **로봇 사양 템플릿(카탈로그)**과 현장에 배속된 **실제 로봇 기기(Fleet)**를 분리하여 관리합니다.

### 1. 로봇 모델 카탈로그 (`/api/robot-models`)
하드웨어 사양(외형 크기, 주행 속도, 기본 알고리즘, SVG 아이콘 등)을 정의합니다. 기본으로 6종(TurtleBot3 Burger, Former 2.0, Atlas, MoBED, SPOT, AGV/AMR)이 제공됩니다.

```bash
GET    /api/robot-models        # 전체 모델 사양 목록
POST   /api/robot-models        # 새 모델 등록 { id, name, type, algorithm, sizeMeters, speedMps, company, description, icon }
PUT    /api/robot-models/:id    # 모델 사양 수정
DELETE /api/robot-models/:id    # 모델 사양 삭제
```

### 2. 배속 로봇 기기 (`/api/robots`)
현장에 투입된 개별 물리/가상 로봇 인스턴스입니다. 기기는 `modelId`를 통해 모델 카탈로그를 참조합니다.

```bash
GET    /api/robots        # 기기 목록 (modelId의 사양 필드가 자동 병합 데코레이션되어 반환)
POST   /api/robots        # 기기 등록 { name, modelId, status, serialNumber?, vda5050Manufacturer?, ... }
PUT    /api/robots/:id    # 기기 상태/정보 수정
DELETE /api/robots/:id    # 기기 삭제
```

**100% 하위 호환성 (API Decorator):**
`GET /api/robots` 호출 시 서버(`server/robots.mjs`)가 기기의 `modelId`를 조회하여 모델의 제원(`sizeMeters`, `speedMps`, `algorithm`, `icon`, `type`)을 기기 객체에 자동 주입(decorate)하여 반환합니다. 따라서 기존 Go 플래너, 실시간 렌더러, VDA5050 브리지 및 모든 레거시 클라이언트와 스모크 테스트가 어떤 수정도 없이 100% 호환됩니다.


## 스캔 장애물 가져오기 (scan-to-map-studio 연동)

```bash
# scan-to-map-studio 프로젝트 폴더(예: ../scan-to-map-studio/projects/bedroom)를
# data/imported/<room>.geojson으로 변환
node scripts/import-scan-to-map-studio.mjs <scan-to-map-studio 프로젝트 폴더> --room <이름> [--wall-thickness 0.15] [--room-walls] [--alignment group_alignment.json [--scan <id>]]
```

`output.geojson`의 `category: "furniture"`(가구 발자국)와 `category: "wall"`(벽 세그먼트, 지정한
두께로 얇은 사각형 block으로 변환)만 `kind: "block"` 장애물로 변환됩니다. `category: "room"`(방
전체 윤곽)은 기본으로는 장애물로 바꾸지 않고 `kind: "room-outline"` 참고용으로만 보존합니다 — "바깥쪽이
막힘"을 표현하려면 홀(hole) 폴리곤이 필요한데 Go `RasterizeBlocks`의 홀 지원 여부가 검증되지
않았기 때문입니다. `--room-walls`를 주면 방 윤곽선의 각 변을 두께 있는 벽 block으로도 함께
내보내 지도를 닫습니다(`derived_from: "room-outline"`). studio의 `pipeline.py`(오케스트레이터가
부르는 경로)는 `--classify`를 켜도 room + furniture만 만들고 wall LineString은 만들지 않으므로,
스캔 지도를 장애물로 닫으려면 이 옵션이 필요합니다. `--alignment`는 프로젝트의
`group_alignment.json`(scan-group-alignment-v1)으로 방을 기준 스캔 좌표계로 옮깁니다.

```bash
GET /api/imported-obstacles         # { rooms: string[] } -- 가져온 방 목록
GET /api/imported-obstacles/:room   # 해당 방의 FeatureCollection (읽기 전용, 쓰기 API 없음)
```

화면에서는 "스캔 장애물" 패널(2D 지도 탭·길찾기(장애물) 탭 왼쪽 아래)에서 방을 골라 "불러오기"를
누르면 공유 소스(`importedObstacleSource`, `src/appShared.js`)에 반영되어 두 탭에 동시에 표시되고,
경로탐색 요청을 만들 때 `nodeLinkSource`(수동 편집)와 자동으로 합쳐집니다. `data/nodelink.geojson`은
전혀 건드리지 않으므로 재가져오기는 언제든 안전합니다.

## 실시간 로봇 위치 (vps-system 연동, ROS 없음)

[vps-system](https://github.com/dcrobot-keen/vps-system)의 VPS 로컬라이제이션 서버(`POST /localize`)와
[scan-to-map-studio](https://github.com/dcrobot-keen/scan-to-map-studio)의 정합 결과(`registration_transform.json`)를
**ROS2를 전혀 거치지 않고** 직접 조합해 실제 로봇 위치를 지도에 표시합니다. vps-system에도 이미
`ros2_ws/src/dc_vps_bridge`(ROS2 노드, tf2 기반)가 있지만 그건 로봇의 Nav2/EKF 스택에 pose를 먹이는
용도이고, 이건 그와 별개인 **브라우저 전용 경로**입니다 — Nav2/EKF가 필요 없는 pathfinder 입장에서
ROS2 설치·tf2·메시지 타입을 전부 우회할 수 있습니다.

```bash
GET  /api/live-pose               # 현재 알려진 모든 로봇의 최신 pose 스냅샷
PUT  /api/live-pose/:robotId      # { x, y, headingRad, timestamp? } -- 캡처 브리지가 씀
# WebSocket ws://.../api/live-pose/stream -- 새 pose가 들어올 때마다 모든 구독자에게 fan-out.
# 새로 접속한 구독자는 다음 업데이트를 기다리지 않고 현재 스냅샷을 바로 받는다.
```

`public/vps-capture.html`(카메라가 있는 기기에서 열기)이 실제 파이프라인입니다: `getUserMedia`로
프레임을 캡처 → vps-system `/localize`에 직접 HTTP POST(카메라가 scan_basemap/hloc-world 프레임
pose를 받음) → `src/livePoseTransform.js`와 동일한 수학(역변환)으로 scan-to-map-studio의 정합값을
적용해 map 프레임으로 변환 → 위 `PUT /api/live-pose/:robotId`. `robotId`가 로봇 등록의 실제 id와
일치하면 등록된 아이콘/이름으로 표시되고, 아니면 기본 마커로 표시됩니다.

**"바깥쪽이 막힘" 대신 알아둘 점 — 카메라 내부 파라미터:** `getUserMedia`는 fx/fy/cx/cy 같은 카메라
캘리브레이션 값을 제공하지 않습니다. `vps_localizer_node.py`(ROS2 버전)는 이미 보정된 `CameraInfo`
토픽에서 이 값을 받지만, 브라우저 카메라는 그런 정보가 없어서 `vps-capture.html`에서 수동으로
입력해야 합니다 — 부정확한 값은 위치추정 정확도를 직접적으로 떨어뜨립니다.

**좌표 변환:** scan-to-map-studio의 `registration_transform.json`은 `map(로봇 SLAM) 좌표 →
scan_basemap 좌표` 방향(`scan_basemap_point = R(rotation_deg) @ map_point + translation`)이므로,
vps-system이 돌려주는 scan_basemap 프레임 pose를 pathfinder가 쓰는 map 프레임으로 옮기려면
**역변환**을 적용해야 합니다 — `dc_vps_bridge`가 ROS2 tf2 lookup으로 자동으로 하던 걸
`src/livePoseTransform.js`가 순수 함수로 직접 계산합니다(`scripts/live-pose-smoke.mjs`로 왕복 검증).

**검증 범위:** 좌표 변환 함수와 서버의 PUT/WebSocket 릴레이는 `npm test`(`scripts/live-pose-smoke.mjs`,
pathfinder의 첫 JS 자동 테스트)로 검증되고, 실제 Chrome에서 서버에 pose를 PUT했을 때 지도에 등록된
로봇 아이콘이 정확한 좌표로 나타나는 것까지 수동으로 확인했습니다. `vps-capture.html`의 카메라
캡처·실제 vps-system 서버 호출 구간은 실제 카메라/서버가 없어 검증하지 못했습니다 — "알려진 제한"
참고.

## 스캔 지도로 프로젝트 만들기 (slicemap-v1)

정합 워크스페이스(scan-to-map-studio)가 시뮬레이터 `worlds/`에 publish한 `<group>.slicemap.json`
하나로 프로젝트를 만듭니다. 메뉴의 **"스캔 지도로 만들기"** 버튼(파일 선택) 또는:

```bash
node scripts/create-project-from-slicemap.mjs ../ros-chromium/simulator/worlds/project_20260905.slicemap.json
```

- 평면 크기 = 격자 크기(`cols*r × rows*r`), 좌표 = 격자 왼쪽-아래를 (0,0)으로 -- 시뮬레이터가 같은
  파일을 `SIM_WORLD`로 쓸 때의 월드 좌표와 동일합니다(`server/slicemap.mjs` 헤더). 그래서 sim-driver의
  VDA5050 `agvPosition`이 변환 없이 이 프로젝트 위에 놓입니다.
- 점유 셀(벽 3 / 가구 2)은 직사각형 block으로 합쳐져 `data/imported/<room>.geojson`에 저장되고, 프로젝트가
  `importedRoom`으로 기억해 열 때 자동으로 불러옵니다.
- VDA5050 `mapId`: sim-driver는 `MAP_ID`가 비어 있으면 시뮬레이터 월드 이름(= slicemap 파일 이름 = 이 프로젝트
  이름)을 씁니다.
- **바닥 이미지**: 정합 워크스페이스가 함께 publish한 `<group>.floor.png/.json`(앱 floorplan 합성, slicemap과
  같은 격자)을 같이 넘기면(`floor: { png, meta }`; 버튼은 파일을 함께 선택, 스크립트는 옆 파일을 자동 감지)
  `data/imported/<room>.floor.png`로 저장되고 프로젝트 `floorImage {url, extent}`가 됩니다. 2D 뷰와 길찾기 탭이
  이를 "바닥 이미지 (앱 스캔)" 레이어로 장애물 아래에 깝니다. 정합을 다시 저장한 뒤에는
  `--project <id>`(`PUT /api/projects/:id/from-slicemap`)로 같은 프로젝트를 갱신합니다.

## 플릿 관제 (RCS) — VDA5050 2.0 브리지

Fleet Studio를 산업 표준 AGV/AMR 관제(RCS) 서버로 동작시키는 통신 및 제어 서브시스템입니다. 상세 설계 및 토픽 규약은 [`../doc/vda5050-rcs.md`](../doc/vda5050-rcs.md) 참고.

- **MQTT 브리지(`server/vda5050.mjs`)**: MQTT 브로커(:1883)에 연결하여 `uagv/v2/<manufacturer>/<serialNumber>/connection`, `state`, `visualization` 토픽을 구독합니다.
- **실시간 위치 릴레이**: 로봇 위치는 기존 `/api/live-pose/stream` fan-out 스트림에 자동 합류되어 지도 뷰어가 MQTT의 존재를 몰라도 실시간 마커가 갱신됩니다.
- **플릿 상태 스트림**: 로봇별 연결 상태, 배터리, 에러, 주문 진행 상황은 `/api/vda5050/stream` WebSocket을 통해 UI로 실시간 브로드캐스트됩니다.
- **주문(Order) 발행 & 진행률 바**: 로봇 목적지를 지정하면 Go 플래너가 벽 인플레이션(로봇 반경 + 5cm)을 반영한 최적 경로를 계산하여 VDA5050 `order` 메시지로 발행합니다. UI에는 현재 로봇이 통과한 노드(`lastNodeId`)와 남은 노드(`nodeStates`)를 기반으로 퍼센트 진행률 바가 실시간 표시됩니다.
- **즉시 제어 (Instant Actions)**: 이동 취소(`cancelOrder`), 일시정지(`startPause`), 주행 재개(`stopPause`)를 즉시 발행할 수 있습니다.
- **주문 이력 및 타임라인 영속화**: 최근 20건의 주문 내역 및 중요한 플릿 이벤트(로봇 온라인/오프라인, 주문 시작/완료, 경고 발생 등)를 `data/vda5050.json`에 안전하게 영속화합니다.
- **자동 기기 배속**: 최초로 감지된 VDA5050 로봇은 `robots.json`에 자동 등록되며, 시뮬레이터 로봇(`tb3-sim-*`)은 카탈로그의 TurtleBot3 Burger 모델과 자동 매핑됩니다.

```bash
GET    /api/vda5050/config                                    # { config, status, supportedInstantActions }
PUT    /api/vda5050/config                                    # 브로커 설정 저장 및 즉시 재접속
GET    /api/vda5050/robots                                    # { robots: [...], status, staleAfterMs }
DELETE /api/vda5050/robots/:manufacturer/:serialNumber        # 목록에서 로봇 제거
POST   /api/vda5050/robots/:manufacturer/:serialNumber/order  # { path: [[x,y],...], mapId? } -> 이동 주문 발행
POST   /api/vda5050/robots/:manufacturer/:serialNumber/instant-actions   # { actionType: cancelOrder|stopPause|startPause }
WS     /api/vda5050/stream                                    # snapshot -> robot/status/orders/timeline 이벤트 스트림
```

## 테스트 커버리지

Fleet Studio는 안정적인 CI/CD와 회귀 방지를 위해 6종의 Node.js 스모크 테스트와 Go 알고리즘 테스트 슈트를 갖추고 있습니다:

```bash
npm test                 # JS 스모크 테스트 6종 순차 실행
npm run test:pathfinder  # Go 단위/통합 테스트 33종 실행
```

1. **`live-pose-smoke.mjs`**: ARKit 좌표계 변환, VPS 지면 투영, `/api/live-pose` PUT 및 WebSocket 릴레이 검증.
2. **`projects-smoke.mjs`**: 현장 프로젝트 CRUD, 프로젝트별 `nodelink.geojson` 저장소 격리 및 검증.
3. **`scan-alignment-smoke.mjs`**: 정합 행렬 변환(group_alignment) 및 좌표계 무결성 검증.
4. **`vda5050-smoke.mjs`**: 가짜 MQTT 클라이언트를 통한 연결/상태/시각화 토픽 수신, 주문 발행 및 즉시 제어 동작 검증.
5. **`scan-project-smoke.mjs`**: `slicemap-v1` 파싱 및 현장 프로젝트/장애물 자동 생성 파이프라인 검증.
6. **`robot-models-smoke.mjs`**: 로봇 모델 카탈로그 CRUD, 기기 인스턴스 배속, API 데코레이터를 통한 하위 호환성 검증.


## PCD 샘플 생성 스크립트

```bash
node scripts/generate-sample-pcd.mjs        # public/samples/sample-room.pcd 재생성
node scripts/generate-random-pcd.mjs 5      # 랜덤 방 PCD 5개 생성 (기본 3개)
```

## PCD → 메쉬 변환 CLI

```bash
node scripts/pcd-to-mesh.mjs <input.pcd> [--out=output.ply] [--voxel=0.08] [--iso=0.5]
```

## 알려진 제한

- PCD 파서는 ASCII/바이너리 포맷을 지원합니다 (binary_compressed는 미지원).
- 마칭 큐브 메쉬는 등위면 경계에서 색이 살짝 어두워지는 코스메틱 아티팩트가 있을 수 있음 (기하 구조에는 영향 없음).
- 로봇 마커 속도/크기는 실제 m/s·m 단위(`robotAnimation.js`의 `metersPerSecond`/`sizeMeters`)로 동작하며, 로봇 미선택 시 기본값(1.0m/s, 0.5m)을 사용합니다. 마커 크기는 로봇 크기에 비례해 화면에 표시되지만 줌 레벨과 무관하게 고정 배율이라 완전한 축척 정확도는 아닙니다.
- Hybrid A*는 실시간 데모 목적의 단순화된 구현(고정 스텝 길이의 자전거 모델 조향 프리미티브, analytic expansion 없음)으로, 실제 로보틱스용 구현 대비 정밀도는 낮음.
- 장애물 회피 경로탐색은 start/end 주변 지역 범위(local search bounds)로만 occupancy grid를 만들고, 그 범위 밖의 장애물은 미리 걸러냅니다(`pathfinder/server/main.go`) — 부지가 커도(200x400m) 계산량이 site 전체 크기에 비례해 늘어나지 않도록 하기 위함. 격자 칸 수가 너무 커지면 `adaptiveCellSize`가 자동으로 해상도를 낮춥니다.
- re-routing은 상위 우선순위 로봇의 "현재 위치"만 임시 원형 장애물로 반영하는 단순한 구현입니다 — 그 로봇이 이동 중인 미래 경로까지 예측해서 피하지는 않습니다.
- PCD에서 장애물 폴리곤/길찾기용 격자를 자동 생성하는 기능은 시도했으나 정확도가 낮아 제거했습니다(`geometryfrompcd.md`에 있던 계획). 지금은 노드/링크/블록을 지도 위에서 직접 그리거나, scan-to-map-studio에서 가져와서(위 "스캔 장애물 가져오기" 참고) 편집합니다.
- scan-to-map-studio에서 가져온 `category: "room"`(방 전체 윤곽)은 아직 장애물로 변환하지 않습니다 — 벽 자체를 "바깥쪽이 막힌" 장애물로 표현하려면 홀(hole) 폴리곤이 필요한데, Go `RasterizeBlocks`가 홀을 실제로 지원하는지 검증되지 않았습니다.
- 스캔 장애물 가져오기는 방 하나가 pathfinder 좌표계 전체를 그대로 쓴다고 가정합니다(1:1, 변환 없음). 여러 방을 동시에 다른 좌표계로 다루려면 `project.md`가 설명하는 미구현 "project"(좌표계/맵 단위 선택) 개념이 먼저 필요합니다.
- 기본 로봇 아이콘(Atlas/MoBED/SPOT/AGV·AMR)은 이미지 생성 도구 없이 손으로 그린 단순 플랫 스타일 SVG로, 실제 로고/사진이 아닌 개략적인 형태 아이콘입니다. 필요하면 폼에서 직접 업로드해 교체할 수 있습니다.
- `public/vps-capture.html`의 좌표 변환 함수는 `src/livePoseTransform.js`와 동일한 코드를 그대로 다시 적어둔 것입니다(이 페이지가 Vite 번들에 안 들어가는 독립 정적 파일이라 import를 못 씀) — 수정 시 두 곳을 같이 바꿔야 하고, 잊으면 조용히 어긋날 수 있습니다.
- 실시간 로봇 위치는 방 하나 = pathfinder 좌표계 전체(1:1, 변환 없음)라는, 스캔 장애물 가져오기와 같은 가정을 그대로 물려받습니다 — 다중 방은 `project.md`의 미구현 "project" 개념이 선행되어야 합니다.
- `vps-capture.html`의 카메라 캡처 → 실제 vps-system 서버 호출 구간은 실제 카메라도 실제로 돌아가는 vps-system 서버도 없어 실행 검증을 못 했습니다. 좌표 변환 수학과 pathfinder 서버 쪽(PUT/WebSocket)만 자동 테스트로 검증됨.
