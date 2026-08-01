# 아이폰 라이다 실내 지도 (PCD → 2D/3D 뷰어)

아이폰 라이다로 스캔한 컬러드 포인트 클라우드(PCD)를 OpenLayers 기반 2D 지도와
Three.js 기반 3D 뷰(점군 / 메쉬)로 함께 보여주는 실내 지도 실험 프로젝트입니다.
전체 기획은 [`3D mesh to 2D.md`](./3D%20mesh%20to%202D.md), [`node-link.md`](./node-link.md), [`path-finding.md`](./path-finding.md) 참고.

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

브라우저에서 상단 탭으로 **2D 지도** / **3D 뷰** / **길찾기(노드·링크)** / **길찾기(장애물)**
네 가지 뷰를 전환할 수 있고, 상단의 **PCD 업로드**로 다른 PCD 파일을 올리면 모든 뷰가
동시에 그 파일 기준으로 갱신됩니다.

1. **2D 지도** — 0,0을 기점으로 하는 m 단위 200m×200m 평면 좌표계 위에 10m 격자를 표시.
2. **3D 컬러드 PCD** — 샘플 PCD를 파싱해 `WebGLVectorLayer`로 실제 RGB 색을 입혀 2D 지도 위에 표시.
3. **높이 슬라이스 2D 레이어** — 같은 포인트 소스를 공유하는 레이어들을 z(높이) 구간별 50cm 단위로 나눠, 우측 패널 체크박스로 층별 on/off.
4. **3D 메쉬 변환** — 점군을 복셀 밀도 필드로 만들고 마칭 큐브(Marching Cubes)로 등위면을 추출해 컬러 메쉬 생성. "3D 뷰" 탭에서 포인트/메쉬 토글, 또는 CLI로 임의의 PCD를 메쉬 파일(PLY)로 변환.
5. **업로드 시 2D/3D 동시 갱신** — 새 PCD를 업로드하면 좌표 범위·높이 슬라이스·3D 점군/카메라가 모두 그 파일 기준으로 자동 재계산.
6. **노드/링크/블록 편집 레이어** — 2D 지도 위에서 노드(point)/링크(line)/블록(polygon)을 그리고 수정·삭제. "저장" 시 GeoJSON `FeatureCollection`으로 API 서버를 통해 `data/nodelink.geojson` 파일에 저장되고, 다음 접속 시 자동으로 다시 불러옴.
7. **길찾기 (노드/링크)** — 별도 탭. 링크 위를 클릭(스냅 지원)해 시작/도착점을 지정하거나 "랜덤 생성"으로 그래프 위 임의의 두 점을 골라 Dijkstra/A*로 경로 탐색. 경로는 랜덤 색 선으로 표시되고, 로봇 마커가 화면 기준 초당 약 2px 속도로 지나가며 지나간 구간은 지워짐.
8. **길찾기 (장애물 회피)** — 별도 탭. 노드/링크 그래프는 무시하고 block(폴리곤)만 장애물로 판단, occupancy grid 위에서 Grid A* 또는 Hybrid A*(연속 좌표+진행방향 고려)로 경로 탐색. 클릭 또는 랜덤 생성으로 시작/도착점 지정, 동일한 경로/로봇 애니메이션.

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
  style.css
server/
  index.mjs               Express + lowdb API 서버 (/api/nodelink)
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
```

## 경로탐색 API (Go)

```bash
# 노드/링크 그래프 위 탐색 (algorithm: dijkstra | astar)
POST /api/path/nodelink   { featureCollection, start: {x,y}, end: {x,y}, algorithm }

# block(폴리곤) 장애물만 피하는 자유공간 탐색 (algorithm: gridastar | hybridastar)
POST /api/path/obstacle   { featureCollection, start: {x,y}, end: {x,y}, algorithm, cellSize }

# 응답: { path: [[x,y], ...], distance, algorithm }
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

- PCD 파서는 ASCII 포맷만 지원 (binary/binary_compressed 미지원).
- 마칭 큐브 메쉬는 등위면 경계에서 색이 살짝 어두워지는 코스메틱 아티팩트가 있을 수 있음 (기하 구조에는 영향 없음).
- 로봇 마커 속도는 명세대로 화면 기준 초당 약 2px로 느림(의도된 값, 필요하면 `robotAnimation.js`의 `pxPerSecond`만 조정하면 됨).
- Hybrid A*는 실시간 데모 목적의 단순화된 구현(고정 스텝 길이의 자전거 모델 조향 프리미티브, analytic expansion 없음)으로, 실제 로보틱스용 구현 대비 정밀도는 낮음.
