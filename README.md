# Robot Orchestration Toolchain

> **모노레포(2026-09-06)** — `scan-engine/` 은 예전 `scan-to-map-studio` 저장소를 `git subtree` 로 합친 것이다(히스토리 보존).
> 파이썬 FastAPI 계산 서비스(천장 제거·ICP·슬라이스·정합·usdz/glb)이고 화면은 이 저장소의 Fleet Studio 가 맡는다.
> `npm run dev` 가 Vite(:3000)·API(:3001)·Go 플래너(:3002)·scan-engine(:8000) 을 함께 띄운다
> (`scan-engine/.venv` 필요: `cd scan-engine && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt -r requirements-server.txt`,
> 설정은 `scan-engine/.env.example` → `.env`). 처리된 스캔 데이터는 `scan-engine/projects/`(gitignored).

## 새 머신에서 띄우기 (macOS Apple Silicon · Windows · Linux 공통, 30~40분)

필요: Node 22, Go 1.22+, Python 3.10~3.13, Docker Desktop(Linux 는 docker engine + compose v2), git. macOS 는 `brew install node@22 go python@3.12` 로.
CUDA 는 필요 없다(3DGS 트윈 `dc-vps-digital-twin` 만 예외 -- 그건 이 스택에 포함되지 않는다).

```bash
# 1. 워크스페이스 폴더 하나에 저장소들을 형제로 둔다
mkdir robot-project && cd robot-project
git clone git@github.com:dcrobot-keen/fleet-studio.git pathfinder  # Fleet Studio + scan-engine (이 저장소)
mkdir ros-chromium && cd ros-chromium
git clone git@github.com:dcrobot-keen/robot-os-chromium.git     # 로봇 스택 (sim-driver, nav.html)
git clone git@github.com:dcrobot-keen/simulator.git             # 2D/3D 시뮬레이터
cd ..
# (선택) iPhone 스캔 그룹 데이터: vps-system/data/<group>/... 를 같은 위치에 복사 -- 정합·3D 메시의 입력

# 2. Fleet Studio
cd pathfinder
npm ci
cd scan-engine && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-server.txt && cp .env.example .env && cd ..
#    (Windows: .venv\Scripts\pip)  .env 의 STUDIO_GROUPS_DIR / STUDIO_PUBLISH_DIR 는 형제 폴더 기준 상대 경로

# 3. 컨테이너 스택 (브로커 · 시뮬레이터 · 로봇 스택 · 대시보드)
cp deploy/.env.example deploy/.env      # 월드 파일 · 로봇 스폰 · ROS_CHROMIUM_DIR
npm run stack:up                        # 첫 실행은 이미지 빌드 포함 (node:22-alpine)

# 4. 실행
npm run dev                             # vite :3000 · api :3001 · 플래너 :3002 · scan-engine :8000
#    브라우저: http://localhost:3000  (설정 › 브로커 mqtt://127.0.0.1:1883 저장하고 연결)
```

- 처음엔 현장이 없다: 지도 › 가져오기로 iPhone 스캔 zip 이나 슬라이스맵 파일을 넣으면 현장·장애물·바닥 이미지가 생기고, 정합 저장 시 시뮬레이터 월드(`simulator/worlds/`)로 publish 된다. `deploy/.env` 의 `SIM_WORLD` 를 그 파일로 바꾸고 `npm run stack:up` 을 다시 하면 시뮬 로봇이 그 지도에서 뜬다.
- 상태 확인: 왼쪽 내비 하단의 점 4개(API · 플래너 · scan-engine · MQTT) 와 상단 배지(MQTT · 로봇 수). `npm test`, `npm run test:scan-engine`, `npm run check:api`.
- Mac 한계: `dc-vps-digital-twin`(CUDA) 과 `vps-system/ros2_ws`(ROS2, SPOT 트랙) 는 돌지 않는다. hloc(VPS 특징 DB) 는 CPU/MPS 로 느리지만 동작. `ios-capture` 앱 빌드는 오히려 Mac(Xcode) 이 필수.

아이폰 라이다로 스캔한 컬러드 포인트 클라우드(PCD)를 기반으로 실내 지도를 만들고,
그 위에서 노드/링크/장애물을 편집하고, 등록된 로봇으로 경로탐색·다중 로봇
충돌회피(deconfliction)까지 실험하는 실내 로봇 오케스트레이션 툴체인입니다.
전체 기획은 [`3D mesh to 2D.md`](./3D%20mesh%20to%202D.md), [`node-link.md`](./node-link.md),
[`path-finding.md`](./path-finding.md), [`robot registry.md`](./robot%20registry.md),
[`deconfliction.md`](./deconfliction.md), [`performance.md`](./performance.md) 참고.
[`project.md`](./project.md)는 프로젝트 개념(좌표계 선택, 프로젝트 단위 관리) 도입을 위한
차기 작업 메모입니다(아직 미구현).

## 기술 스택

- [Vite](https://vitejs.dev/) + 순수 JavaScript
- [OpenLayers](https://openlayers.org/) — 2D 지도 (m 단위 평면 좌표계)
- [Three.js](https://threejs.org/) — 3D orbit 뷰 (점군 / 마칭 큐브 메쉬)
- [Express](https://expressjs.com/) + [lowdb](https://github.com/typicode/lowdb) — 노드/링크/블록 편집 결과를 GeoJSON 파일로 저장하는 초경량 API 서버
- Go(표준 라이브러리만 사용) — 경로탐색 알고리즘(Dijkstra/A*/Grid A*/Hybrid A*) + HTTP API 서버
- Node.js 스크립트 — PCD 샘플 생성, PCD → 메쉬 변환 CLI
- [ws](https://github.com/websockets/ws) — 실시간 로봇 위치를 브라우저에 fan-out하는 WebSocket 릴레이

## 실행

```bash
npm install
npm run dev          # Vite(5173) + lowdb API(3001) + Go pathfinder API(3002) 동시 실행
npm run build         # 프로덕션 빌드 (dist/)
npm test              # JS 테스트 (좌표 변환 + 실시간 위치 API/WebSocket)
npm run test:pathfinder  # Go 경로탐색 알고리즘 테스트
```

`npm run dev`는 `concurrently`로 세 프로세스를 함께 띄웁니다. 개별 실행은
`dev:client` / `dev:server` / `dev:pathfinder`를 사용하세요. Go 툴체인이 PATH에
있어야 `dev:pathfinder`가 동작합니다 (`go version`으로 확인).

## 기능 개요

브라우저에서 상단 탭으로 **3D 뷰** / **2D 뷰** / **로봇 등록** / **길찾기(장애물)** 네 가지
뷰를 전환할 수 있고, 상단의 **PCD 업로드**로 다른 PCD 파일을 올리면 지도/3D/길찾기 뷰가
동시에 그 파일 기준으로 갱신됩니다. (구 "길찾기(노드/링크)" 탭은 UI에서는 뺐지만 관련
코드는 재사용을 위해 그대로 남아 있습니다 — 아래 프로젝트 구조 참고.)

1. **2D 지도** — 0,0을 기점으로 하는 m 단위 200m(가로)×400m(세로) 평면 좌표계 위에 10m 격자를 표시. 배경 도면(blueprint) 이미지 레이어를 겹쳐 보이게 할 수 있음(기본 꺼짐).
2. **3D 컬러드 PCD** — PCD(ASCII/바이너리 모두 지원)를 파싱해 `WebGLVectorLayer`로 실제 RGB 색을 입혀 2D 지도 위에 표시.
3. **높이 슬라이스 2D 레이어 + 레이어 패널** — 같은 포인트 소스를 공유하는 레이어들을 z(높이) 구간별 50cm 단위로 나눠, 우측 패널 체크박스로 층별 on/off. 같은 패널 컴포넌트(`renderSlicePanel`)를 배경 도면·노드/링크/블록 레이어 토글에도, 길찾기(장애물) 탭의 바닥 PCD·노드/링크/블록 레이어 토글에도 재사용.
4. **3D 메쉬 변환** — 점군을 복셀 밀도 필드로 만들고 마칭 큐브(Marching Cubes)로 등위면을 추출해 컬러 메쉬 생성. "3D 뷰" 탭에서 포인트/메쉬 토글, 또는 CLI로 임의의 PCD를 메쉬 파일(PLY)로 변환.
5. **업로드 시 2D/3D 동시 갱신** — 새 PCD를 업로드하면 좌표 범위·높이 슬라이스·3D 점군/카메라가 모두 그 파일 기준으로 자동 재계산.
6. **노드/링크/블록 편집 레이어** — 2D 지도 위에서 노드(point)/링크(line)/블록(polygon)을 그리고 수정·삭제. "저장" 시 GeoJSON `FeatureCollection`으로 API 서버를 통해 `data/nodelink.geojson` 파일에 저장되고, 다음 접속 시 자동으로 다시 불러옴. PCD로부터 장애물/격자를 자동 생성하는 기능은 시도했다가 정확도가 낮아 제거했고, 지금은 이 레이어에서 수동 편집하는 방식만 사용합니다.
6-1. **스캔 장애물 (scan-to-map-studio 연동)** — 자매 저장소 [scan-to-map-studio](../scan-to-map-studio)가 iPhone LiDAR 스캔에서 뽑아낸 방 하나 분량의 `output.geojson`(가구 발자국·벽 세그먼트·방 윤곽선)을 `scripts/import-scan-to-map-studio.mjs`로 변환해 `data/imported/<room>.geojson`에 저장합니다. 화면의 "스캔 장애물" 패널에서 방을 골라 불러오면 편집 지도/길찾기(장애물) 탭 모두에 빨간색 블록으로 표시되고, 경로탐색 요청을 만들 때 `nodeLinkSource`(수동 편집)와 자동으로 합쳐져서 Go pathfinder API로 전송됩니다. `data/nodelink.geojson`(사용자가 손으로 편집하는 파일)은 전혀 건드리지 않으므로 재가져오기(re-import)가 항상 안전합니다. 자세한 설계 배경은 [`../doc/architecture-improvements.md`](../doc/architecture-improvements.md) 참고.
7. **길찾기 (노드/링크)** — (현재 탭 메뉴에는 없음, 코드는 `pathfinding/tab.js`의 `mode: 'nodelink'`로 유지) 링크 위를 클릭(스냅 지원)해 시작/도착점을 지정하거나 "랜덤 생성"으로 그래프 위 임의의 두 점을 골라 Dijkstra/A*로 경로 탐색.
8. **길찾기 (장애물 회피)** — 노드/링크 그래프는 무시하고 block(폴리곤)만 장애물로 판단, occupancy grid 위에서 Grid A* 또는 Hybrid A*(연속 좌표+진행방향 고려)로 경로 탐색. 클릭 또는 랜덤 생성으로 시작/도착점 지정. 경로는 랜덤 색 선으로 표시되고, 로봇 마커가 실제 m/s 속도로 지나가며 지나간 구간은 지워짐(속도는 로봇 미선택 시 기본 1.0m/s). 도착하면 로봇 마커·남은 경로선·start/end 핀이 모두 지도에서 사라짐.
   - **등록된 로봇 선택** — 로봇을 고르면 그 로봇의 알고리즘이 자동 적용(수동 선택 잠금)되고, 로봇 마커가 원형 점 대신 해당 로봇의 아이콘으로, **등록된 실제 속도(m/s)·크기(m)**에 맞춰 표시/이동함. 로봇 목록은 유효한 알고리즘(gridastar/hybridastar)을 가진 로봇만 필터링해서 보여줌.
   - **Deconfliction 가시화** — 로봇 선택 콤보 밑에 현재 진행 중인 모든 경로가 실시간 리스트로 표시되며, 각 항목은 해당 경로 선과 같은 색 스와치 + 생성 번호(`#id`)를 가짐. 같은 번호가 지도 위 이동 중인 로봇 아이콘 위에도 겹쳐 표시됨.
   - **Priority 변경** — 리스트 항목을 드래그앤드롭으로 순서를 바꾸면 즉시 그 로봇의 충돌회피 우선순위가 바뀜(먼저 배치된 항목이 더 높은 우선순위). 각 항목에 생성 번호(`#id`)와 현재 우선순위 순번(`우선순위 N`)을 함께 표시해 둘을 구분.
   - **충돌 감지(공통 로직)** — 200ms마다 모든 활성 경로 쌍에 대해 "남은 경로(remaining path)"끼리의 최근접 거리를 계산. 판정 반경은 로봇 크기 기반(두 로봇 sizeMeters 합의 배수), 실제로 경로가 스쳐 지나가는 쌍에만 적용하고(나란히 가는 평행 경로는 제외), 비교 구간도 각 로봇의 현재 속도에 비례한 lookahead 거리로 제한해 아직 멀리 있는 로봇끼리 미리 멈추는 문제를 방지함.
   - **충돌 해소 방식 선택** — "충돌 시" 콤보에서 **정지 후 재개(pause & resume)** 또는 **재탐색(re-routing)** 을 선택 가능.
     - *정지 후 재개*: 우선순위가 낮은 쪽을 멈추고(마커 반투명), 위험 반경을 벗어나는 즉시(별도 대기 없이) 재개. 매 틱 현재 활성 로봇 전체를 기준으로 재판정하므로 막고 있던 로봇이 먼저 도착해 사라지면 대기 중이던 로봇도 즉시 자동으로 풀림.
     - *재탐색*: 낮은 우선순위 로봇을 멈추고, 상위 우선순위 로봇들의 현재 위치를 임시 원형 장애물로 취급해 현재 위치→원래 목적지 사이 경로를 Go pathfinder API로 다시 계산, 성공하면 같은 번호/색으로 새 애니메이션으로 교체. 실패하면 계속 정지 상태로 다음 틱에 재시도.
9. **로봇 등록 (CRUD)** — 별도 탭. 타입(휴머노이드/AGV·AMR/4족보행/4바퀴 non-holonomic/알수없음), 길찾기 알고리즘(코드값 — pathfinder API와 동일한 dijkstra/astar/gridastar/hybridastar), 상태(미션 중/충전 중/연결 실패/대기중/고장), **크기(m)·이동 속도(m/s)**, 회사·설명, 아이콘 업로드까지 갖춘 로봇 등록/수정/삭제. 최초 실행 시 Atlas(휴머노이드, Grid A*, 0.55m/1.5m·s), MoBED(4바퀴, Hybrid A*, 0.6m/0.8m·s), SPOT(4족보행, Grid A*, 0.7m/1.2m·s), AGV·AMR(A*, 0.9m/1.2m·s) 4종이 기본 아이콘과 함께 자동 시드됨.

## 프로젝트 구조

```
index.html             탭(3D/2D/로봇 등록/길찾기(장애물)), PCD 업로드, 각종 패널 UI
vite.config.js          /api/path -> Go(3002), /api -> Express(3001) 프록시
src/
  main.js               지도/탭/업로드 오케스트레이션 (앱 진입점), 배경 도면 레이어, 뷰 extent 설정
  appShared.js            좌표계(200x400m indoor-plane) + 공유 VectorSource(PCD, 노드/링크) — 탭 간 상태 공유
  grid2d.js                재사용 가능한 sizeX x sizeY 격자 레이어
  nodeLinkStyle.js          노드/링크/블록 공통 스타일
  pcd.js                 PCD 파서 (ASCII/바이너리, FIELDS x y z rgb)
  heightSlices.js        z 구간별 높이 슬라이스 레이어 생성 + 레이어 토글 패널 렌더링(renderSlicePanel, 여러 탭에서 재사용)
  meshify.js             점군 → 복셀 밀도 필드 → 마칭 큐브 메쉬 변환
  ply.js                 메쉬 → ASCII PLY 직렬화
  view3d.js               Three.js 3D orbit 뷰어 (점군/메쉬 렌더링)
  editLayer.js            노드/링크/블록 그리기·수정·삭제 + 저장/불러오기 툴바
  geojsonApi.js            편집 레이어의 GeoJSON 저장/조회 API 클라이언트
  importedObstacles.js     "스캔 장애물" 패널 (scan-to-map-studio에서 가져온 방 목록 선택/불러오기) + 스타일
  importedObstaclesApi.js  가져온 장애물 목록/조회 API 클라이언트
  livePoseTransform.js     scan_basemap <-> map 좌표 역/정변환 (ROS 없이, vps-capture.html과 동일 수학)
  liveRobotPose.js         /api/live-pose/stream WebSocket 구독 + 로봇 아이콘 마커 갱신
  pathfinding/
    tab.js                 길찾기 탭 공통 팩토리 (노드/링크·장애물 두 모드, 현재 UI에는 장애물 탭만 노출) — deconfliction(가시화/우선순위 드래그앤드롭/재탐색) 포함
    pathfindingApi.js        Go pathfinder API 클라이언트
    robotAnimation.js        경로 애니메이션(로봇 마커 + trail 삭제 + 아이콘 위 번호 라벨)
  robots/
    robotRegistry.js         로봇 등록 CRUD 탭 (폼 + 카드 목록)
    robotApi.js               로봇 CRUD API 클라이언트
    robotCodes.js              타입/알고리즘/상태 코드값 <-> 라벨 매핑
  style.css
shared/
  robotIcons.mjs           로봇 타입별 기본 SVG 아이콘 (서버 시드 + 프론트 폼 미리보기 공용)
server/
  index.mjs               Express + lowdb API 서버 (/api/nodelink) + 실시간 로봇 위치 릴레이
                            (/api/live-pose, WebSocket /api/live-pose/stream)
  robots.mjs                로봇 등록 CRUD API (/api/robots) + 기본 4종 자동 시드
  vda5050.mjs               VDA5050 MQTT 브리지 (/api/vda5050/*): 브로커 구독 -> live-pose 합류 + 플릿 상태, order/instantActions 발행
pathfinder/               Go 모듈 — 경로탐색 알고리즘 + HTTP API + WASM
  graph/                   Dijkstra/A*, 그래프 스냅/가상노드 삽입
  grid/                    occupancy grid, Grid A*, Hybrid A*. NewGridFromOccupancy로 폴리곤 대신
                            원시 점유 비트맵(예: LIDAR 누적 costmap)을 직접 주입 가능
  server/                  net/http API 서버 (/api/path/nodelink, /api/path/obstacle) — 지역 검색 범위·장애물 필터링·격자 해상도 자동 조정으로 대형 부지에서도 빠른 응답
  wasm/                    grid 패키지를 GOOS=js GOARCH=wasm으로 노출 (pathfinderFindPath) — 서버 없이
                            브라우저에서 직접 호출. 첫 소비자: ros-chromium/robot-os-chromium의 PlannerNode
scripts/
  pcd-lib.mjs             PCD 생성 스크립트 공용 유틸 (rgb 패킹, ascii 저장)
  generate-sample-pcd.mjs   고정 샘플 방 PCD 생성
  generate-random-pcd.mjs   랜덤 방 PCD 여러 개 생성 (업로드 테스트용)
  pcd-to-mesh.mjs           PCD → 메쉬(PLY) 변환 CLI
  import-scan-to-map-studio.mjs   scan-to-map-studio의 output.geojson -> data/imported/<room>.geojson 변환
  build-wasm.mjs           pathfinder/wasm -> dist-wasm/pathfinder.wasm + wasm_exec.js 빌드
  live-pose-smoke.mjs      pathfinder의 첫 JS 자동 테스트 -- 좌표 변환 + 서버 PUT/WebSocket 릴레이 검증
  vda5050-smoke.mjs        VDA5050 브리지 검증 (가짜 MQTT 클라이언트 주입, 브로커 불필요)
public/samples/            샘플 PCD 파일들 (앱이 초기 로드에 사용). 100MB를 넘는 실측 스캔 파일은
                            GitHub 용량 제한 때문에 git에 커밋하지 않고 로컬에만 둠(.gitignore 참고).
public/vps-capture.html    카메라 → vps-system /localize → map 프레임 변환 → /api/live-pose PUT까지
                            하는 독립 정적 페이지(Vite 번들에 안 들어감, ROS 없음)
data/nodelink.geojson       노드/링크/블록 편집 결과 GeoJSON 파일 DB
data/robots.json            로봇 등록 CRUD 데이터 (최초 실행 시 4종 자동 시드)
data/imported/<room>.geojson  scan-to-map-studio에서 가져온 장애물(스크립트로만 생성, git에는 커밋 안 함)
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

## 로봇 등록 API

```bash
GET    /api/robots        # 목록
POST   /api/robots        # 생성 { name, type, algorithm, status, sizeMeters, speedMps, company, description, icon }
PUT    /api/robots/:id    # 수정 (부분 업데이트)
DELETE /api/robots/:id    # 삭제
```

`type`/`algorithm`/`status`는 코드값(`src/robots/robotCodes.js`, `server/robots.mjs`에 정의)만 허용되고,
알 수 없는 값이 오면 안전한 기본값으로 대체됩니다. `sizeMeters`(로봇 폭/지름, m)와 `speedMps`(이동 속도, m/s)는
양수만 허용되며 잘못된 값은 기본값(0.5m / 1.0m/s)이나 기존 값으로 대체됩니다. `icon`은 data URI
문자열(업로드한 이미지 또는 `shared/robotIcons.mjs`의 기본 SVG)로 저장됩니다.

## 스캔 장애물 가져오기 (scan-to-map-studio 연동)

```bash
# scan-to-map-studio 프로젝트 폴더(예: scan-engine/projects/bedroom)를
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

## 플릿 (RCS) — VDA5050 브리지

pathfinder를 관제(RCS) 쪽으로 세우는 탭입니다. 설계와 우리가 고정한 규약(토픽 접두사
`uagv/v2/<manufacturer>/<serialNumber>`, `mapId` = 프로젝트 이름, 좌표 = pathfinder 평면)은
[`../doc/vda5050-rcs.md`](../doc/vda5050-rcs.md) 참고.

- **서버(`server/vda5050.mjs`)**가 MQTT 브로커에 붙어 `connection`/`state`/`visualization`을 구독합니다.
  위치는 기존 `/api/live-pose/stream` fan-out에 그대로 합류하므로 2D/길찾기 탭의 마커 코드는 전송
  수단을 모릅니다. 로봇별 플릿 상태(연결·주문·오류)는 `/api/vda5050/stream` WebSocket으로 탭에 흐릅니다.
- **"플릿 (RCS)" 탭**에서 브로커 URL·구독 목록을 저장하면 즉시 재접속하고(`data/vda5050.json`,
  기본 `enabled:false`), 로봇 표에서 `cancelOrder`/`stopPause`/`startPause`를 보냅니다.
- **길찾기 탭의 "시뮬레이터로 실행"**은 그 robotId가 VDA5050으로 ONLINE이면 서버가 자동으로
  `order`로 발행하고(`transport: "vda5050"`), 아니면 예전 `drive-request` WebSocket 릴레이를 씁니다.
- 로봇 쪽 상대는 ros-chromium `robot-os-chromium/packages/nodes`의 `Vda5050Node`(sim-driver가
  `MQTT_URL`로 켬)이고, 브로커는 ros-chromium compose의 `mosquitto`(127.0.0.1:1883)입니다.
- **자동 등록**: 처음 보는 VDA5050 로봇은 서버가 로봇 등록(`robots.json`)에 자동으로 넣습니다
  (`vda5050Serial`/`vda5050Manufacturer` 필드, 시뮬레이터 serial은 TB3 치수 0.2 m / 0.22 m/s, AGV 아이콘).
  지도 마커는 serial로 이 항목을 찾아 아이콘·이름을 붙입니다. 로봇 등록 탭에서 수정할 수 있습니다.
- **이동 명령**: 길찾기(장애물) 탭의 "실제 로봇 이동 명령 (VDA5050)"에서 로봇을 고르고 "목적지 클릭" 뒤
  지도를 클릭하면, 로봇의 현재 위치에서 그 지점까지 경로를 찾아(로봇의 알고리즘) order로 보냅니다.
  계획 경로는 주황 점선으로 남고, 도착(`nodeStates` 0)하면 지워집니다. 경로는 Go 계획기에
  `inflationM`(로봇 반경 + 5 cm)을 넘겨 벽에서 그만큼 떨어지게 계산합니다(0.1 m 격자). 벽에 너무 가까운
  목적지는 계획기가 거절합니다.

```bash
GET    /api/vda5050/config                                    # { config, status, supportedInstantActions }
PUT    /api/vda5050/config                                    # 저장 + 재접속. body = config
GET    /api/vda5050/robots                                    # { robots: [...], status, staleAfterMs }
DELETE /api/vda5050/robots/:manufacturer/:serialNumber        # 표에서 제거
POST   /api/vda5050/robots/:manufacturer/:serialNumber/order  # { path: [[x,y],...], mapId?, updatePrevious? } -> { orderId, orderUpdateId }
POST   /api/vda5050/robots/:manufacturer/:serialNumber/instant-actions   # { actionType: cancelOrder|stopPause|startPause }
WS     /api/vda5050/stream                                    # snapshot -> robot/status/forget 이벤트
```

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
