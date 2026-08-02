# 아이폰 라이다 실내 지도 (PCD → 2D/3D 뷰어)

아이폰 라이다로 스캔한 컬러드 포인트 클라우드(PCD)를 OpenLayers 기반 2D 지도와
Three.js 기반 3D 뷰(점군 / 메쉬)로 함께 보여주는 실내 지도 실험 프로젝트입니다.
전체 기획은 [`3D mesh to 2D.md`](./3D%20mesh%20to%202D.md), [`node-link.md`](./node-link.md), [`path-finding.md`](./path-finding.md), [`robot registry.md`](./robot%20registry.md) 참고.

## 기술 스택

- [Vite](https://vitejs.dev/) + 순수 JavaScript
- [OpenLayers](https://openlayers.org/) — 2D 지도 (m 단위 평면 좌표계)
- [Three.js](https://threejs.org/) — 3D orbit 뷰 (점군 / 마칭 큐브 메쉬)
- [Express](https://expressjs.com/) + [lowdb](https://github.com/typicode/lowdb) — 노드/링크/블록 편집 결과를 GeoJSON 파일로 저장하는 초경량 API 서버
- Go(표준 라이브러리만 사용) — 경로탐색 알고리즘(Dijkstra/A*/Grid A*/Hybrid A*) + HTTP API 서버
- Node.js 스크립트 — PCD 샘플 생성, PCD → 메쉬 변환 CLI

## 실행

```bash
npm install
npm run dev          # Vite(5173) + lowdb API(3001) + Go pathfinder API(3002) 동시 실행
npm run build         # 프로덕션 빌드 (dist/)
npm run test:pathfinder  # Go 경로탐색 알고리즘 테스트
```

`npm run dev`는 `concurrently`로 세 프로세스를 함께 띄웁니다. 개별 실행은
`dev:client` / `dev:server` / `dev:pathfinder`를 사용하세요. Go 툴체인이 PATH에
있어야 `dev:pathfinder`가 동작합니다 (`go version`으로 확인).

## 기능 개요

브라우저에서 상단 탭으로 **2D 지도** / **3D 뷰** / **길찾기(노드·링크)** / **길찾기(장애물)** /
**로봇 등록** 다섯 가지 뷰를 전환할 수 있고, 상단의 **PCD 업로드**로 다른 PCD 파일을 올리면
지도/3D/길찾기 뷰가 동시에 그 파일 기준으로 갱신됩니다.

1. **2D 지도** — 0,0을 기점으로 하는 m 단위 200m×200m 평면 좌표계 위에 10m 격자를 표시.
2. **3D 컬러드 PCD** — 샘플 PCD를 파싱해 `WebGLVectorLayer`로 실제 RGB 색을 입혀 2D 지도 위에 표시.
3. **높이 슬라이스 2D 레이어** — 같은 포인트 소스를 공유하는 레이어들을 z(높이) 구간별 50cm 단위로 나눠, 우측 패널 체크박스로 층별 on/off.
4. **3D 메쉬 변환** — 점군을 복셀 밀도 필드로 만들고 마칭 큐브(Marching Cubes)로 등위면을 추출해 컬러 메쉬 생성. "3D 뷰" 탭에서 포인트/메쉬 토글, 또는 CLI로 임의의 PCD를 메쉬 파일(PLY)로 변환.
5. **업로드 시 2D/3D 동시 갱신** — 새 PCD를 업로드하면 좌표 범위·높이 슬라이스·3D 점군/카메라가 모두 그 파일 기준으로 자동 재계산.
6. **노드/링크/블록 편집 레이어** — 2D 지도 위에서 노드(point)/링크(line)/블록(polygon)을 그리고 수정·삭제. "저장" 시 GeoJSON `FeatureCollection`으로 API 서버를 통해 `data/nodelink.geojson` 파일에 저장되고, 다음 접속 시 자동으로 다시 불러옴.
7. **길찾기 (노드/링크)** — 별도 탭. 링크 위를 클릭(스냅 지원)해 시작/도착점을 지정하거나 "랜덤 생성"으로 그래프 위 임의의 두 점을 골라 Dijkstra/A*로 경로 탐색. 경로는 랜덤 색 선으로 표시되고, 로봇 마커가 실제 m/s 속도로 지나가며 지나간 구간은 지워짐(속도는 로봇 미선택 시 기본 1.0m/s). 도착하면 로봇 마커·남은 경로선·start/end 핀이 모두 지도에서 사라짐.
8. **길찾기 (장애물 회피)** — 별도 탭. 노드/링크 그래프는 무시하고 block(폴리곤)만 장애물로 판단, occupancy grid 위에서 Grid A* 또는 Hybrid A*(연속 좌표+진행방향 고려)로 경로 탐색. 클릭 또는 랜덤 생성으로 시작/도착점 지정, 동일한 경로/로봇 애니메이션.
   - 두 탭 모두 상단에서 **등록된 로봇을 선택**할 수 있음 — 로봇을 고르면 그 로봇의 알고리즘이 자동 적용(수동 선택 잠금)되고, 로봇 마커가 원형 점 대신 해당 로봇의 아이콘으로, **등록된 실제 속도(m/s)·크기(m)**에 맞춰 표시/이동함. 로봇 목록은 각 탭에서 유효한 알고리즘(노드/링크 탭은 dijkstra/astar, 장애물 탭은 gridastar/hybridastar)을 가진 로봇만 필터링해서 보여줌.
   - **Deconfliction (1단계: 감지 + pause)** — 같은 탭에서 여러 start/end 쌍을 동시에 진행시키면 200ms마다 모든 로봇 쌍의 거리를 체크. 반경은 로봇 크기(등록된 sizeMeters, 미선택 시 0.5m) 기반: 두 로봇 크기 평균 이내로 근접하면 나중에 출발한(우선순위 낮은) 로봇을 멈추고(마커가 반투명해짐), 지나가는(우선순위 높은) 로봇 크기만큼 더 벌어지고 거리가 실제로 늘어나는 추세일 때만 재개(flapping 방지). 매 틱마다 현재 활성 로봇 전체를 기준으로 다시 판정하므로, 막고 있던 로봇이 먼저 도착해 사라지면 대기 중이던 로봇도 즉시 자동으로 풀림(이전엔 여기서 영구 정지 버그가 있었음). 재탐색(re-routing)은 아직 없음 — 다음 단계로 제안된 상태.
9. **로봇 등록 (CRUD)** — 별도 탭. 타입(휴머노이드/AGV·AMR/4족보행/4바퀴 non-holonomic/알수없음), 길찾기 알고리즘(코드값 — pathfinder API와 동일한 dijkstra/astar/gridastar/hybridastar), 상태(미션 중/충전 중/연결 실패/대기중/고장), **크기(m)·이동 속도(m/s)**, 회사·설명, 아이콘 업로드까지 갖춘 로봇 등록/수정/삭제. 최초 실행 시 Atlas(휴머노이드, Grid A*, 0.55m/1.5m·s), MoBED(4바퀴, Hybrid A*, 0.6m/0.8m·s), SPOT(4족보행, Grid A*, 0.7m/1.2m·s), AGV·AMR(A*, 0.9m/1.2m·s) 4종이 기본 아이콘과 함께 자동 시드됨.

## 프로젝트 구조

```
index.html             탭(2D/3D/길찾기x2), PCD 업로드, 각종 패널 UI
vite.config.js          /api/path -> Go(3002), /api -> Express(3001) 프록시
src/
  main.js               지도/탭/업로드 오케스트레이션 (앱 진입점)
  appShared.js            좌표계 + 공유 VectorSource(PCD, 노드/링크) — 탭 간 상태 공유
  grid2d.js                재사용 가능한 10m 격자 레이어
  nodeLinkStyle.js          노드/링크/블록 공통 스타일
  pcd.js                 ASCII PCD 파서 (FIELDS x y z rgb)
  heightSlices.js        z 구간별 높이 슬라이스 레이어 생성 + 패널 렌더링
  meshify.js             점군 → 복셀 밀도 필드 → 마칭 큐브 메쉬 변환
  ply.js                 메쉬 → ASCII PLY 직렬화
  view3d.js               Three.js 3D orbit 뷰어 (점군/메쉬 렌더링)
  editLayer.js            노드/링크/블록 그리기·수정·삭제 + 저장/불러오기 툴바
  geojsonApi.js            편집 레이어의 GeoJSON 저장/조회 API 클라이언트
  pathfinding/
    tab.js                 길찾기 탭 공통 팩토리 (노드/링크·장애물 두 모드)
    pathfindingApi.js        Go pathfinder API 클라이언트
    robotAnimation.js        경로 애니메이션(로봇 마커 + trail 삭제)
  robots/
    robotRegistry.js         로봇 등록 CRUD 탭 (폼 + 카드 목록)
    robotApi.js               로봇 CRUD API 클라이언트
    robotCodes.js              타입/알고리즘/상태 코드값 <-> 라벨 매핑
  style.css
shared/
  robotIcons.mjs           로봇 타입별 기본 SVG 아이콘 (서버 시드 + 프론트 폼 미리보기 공용)
server/
  index.mjs               Express + lowdb API 서버 (/api/nodelink)
  robots.mjs                로봇 등록 CRUD API (/api/robots) + 기본 4종 자동 시드
pathfinder/               Go 모듈 — 경로탐색 알고리즘 + HTTP API
  graph/                   Dijkstra/A*, 그래프 스냅/가상노드 삽입
  grid/                    occupancy grid, Grid A*, Hybrid A*
  server/                  net/http API 서버 (/api/path/nodelink, /api/path/obstacle)
scripts/
  pcd-lib.mjs             PCD 생성 스크립트 공용 유틸 (rgb 패킹, ascii 저장)
  generate-sample-pcd.mjs   고정 샘플 방 PCD 생성
  generate-random-pcd.mjs   랜덤 방 PCD 여러 개 생성 (업로드 테스트용)
  pcd-to-mesh.mjs           PCD → 메쉬(PLY) 변환 CLI
public/samples/            샘플 PCD 파일들 (앱이 초기 로드에 사용)
data/nodelink.geojson       노드/링크/블록 편집 결과 GeoJSON 파일 DB
data/robots.json            로봇 등록 CRUD 데이터 (최초 실행 시 4종 자동 시드)
```

## 경로탐색 API (Go)

```bash
# 노드/링크 그래프 위 탐색 (algorithm: dijkstra | astar)
POST /api/path/nodelink   { featureCollection, start: {x,y}, end: {x,y}, algorithm }

# block(폴리곤) 장애물만 피하는 자유공간 탐색 (algorithm: gridastar | hybridastar)
POST /api/path/obstacle   { featureCollection, start: {x,y}, end: {x,y}, algorithm, cellSize }

# 응답: { path: [[x,y], ...], distance, algorithm }
```

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

- PCD 파서는 ASCII 포맷만 지원 (binary/binary_compressed 미지원).
- 마칭 큐브 메쉬는 등위면 경계에서 색이 살짝 어두워지는 코스메틱 아티팩트가 있을 수 있음 (기하 구조에는 영향 없음).
- 로봇 마커 속도/크기는 실제 m/s·m 단위(`robotAnimation.js`의 `metersPerSecond`/`sizeMeters`)로 동작하며, 로봇 미선택 시 기본값(1.0m/s, 0.5m)을 사용합니다. 마커 크기는 로봇 크기에 비례해 화면에 표시되지만 줌 레벨과 무관하게 고정 배율이라 완전한 축척 정확도는 아닙니다.
- Hybrid A*는 실시간 데모 목적의 단순화된 구현(고정 스텝 길이의 자전거 모델 조향 프리미티브, analytic expansion 없음)으로, 실제 로보틱스용 구현 대비 정밀도는 낮음.
- 기본 로봇 아이콘(Atlas/MoBED/SPOT/AGV·AMR)은 이미지 생성 도구 없이 손으로 그린 단순 플랫 스타일 SVG로, 실제 로고/사진이 아닌 개략적인 형태 아이콘입니다. 필요하면 폼에서 직접 업로드해 교체할 수 있습니다.
