# 아이폰 라이다 실내 지도 (PCD → 2D/3D 뷰어)

아이폰 라이다로 스캔한 컬러드 포인트 클라우드(PCD)를 OpenLayers 기반 2D 지도와
Three.js 기반 3D 뷰(점군 / 메쉬)로 함께 보여주는 실내 지도 실험 프로젝트입니다.
전체 기획은 [`3D mesh to 2D.md`](./3D%20mesh%20to%202D.md), [`node-link.md`](./node-link.md) 참고.

## 기술 스택

- [Vite](https://vitejs.dev/) + 순수 JavaScript
- [OpenLayers](https://openlayers.org/) — 2D 지도 (m 단위 평면 좌표계)
- [Three.js](https://threejs.org/) — 3D orbit 뷰 (점군 / 마칭 큐브 메쉬)
- [Express](https://expressjs.com/) + [lowdb](https://github.com/typicode/lowdb) — 노드/링크/블록 편집 결과를 GeoJSON 파일로 저장하는 초경량 API 서버
- Node.js 스크립트 — PCD 샘플 생성, PCD → 메쉬 변환 CLI

## 실행

```bash
npm install
npm run dev         # Vite(5173) + API 서버(3001) 동시 실행
npm run build        # 프로덕션 빌드 (dist/)
```

`npm run dev`는 `concurrently`로 Vite 개발 서버와 Express API 서버를 함께 띄웁니다.
따로 띄우려면 `npm run dev:client` / `npm run dev:server`를 사용하세요.

## 기능 개요

브라우저에서 상단 탭으로 **2D 지도**와 **3D 뷰**를 전환할 수 있고, 상단의
**PCD 업로드**로 다른 PCD 파일을 올리면 2D/3D 두 뷰가 동시에 그 파일 기준으로 갱신됩니다.

1. **2D 지도** — 0,0을 기점으로 하는 m 단위 200m×200m 평면 좌표계 위에 10m 격자를 표시.
2. **3D 컬러드 PCD** — 샘플 PCD를 파싱해 `WebGLVectorLayer`로 실제 RGB 색을 입혀 2D 지도 위에 표시.
3. **높이 슬라이스 2D 레이어** — 같은 포인트 소스를 공유하는 레이어들을 z(높이) 구간별 50cm 단위로 나눠, 우측 패널 체크박스로 층별 on/off.
4. **3D 메쉬 변환** — 점군을 복셀 밀도 필드로 만들고 마칭 큐브(Marching Cubes)로 등위면을 추출해 컬러 메쉬 생성. "3D 뷰" 탭에서 포인트/메쉬 토글, 또는 CLI로 임의의 PCD를 메쉬 파일(PLY)로 변환.
5. **업로드 시 2D/3D 동시 갱신** — 새 PCD를 업로드하면 좌표 범위·높이 슬라이스·3D 점군/카메라가 모두 그 파일 기준으로 자동 재계산.
6. **노드/링크/블록 편집 레이어** — 2D 지도 위에서 노드(point)/링크(line)/블록(polygon)을 그리고 수정·삭제. "저장" 시 GeoJSON `FeatureCollection`으로 API 서버를 통해 `data/nodelink.geojson` 파일에 저장되고, 다음 접속 시 자동으로 다시 불러옴.

## 프로젝트 구조

```
index.html            2D/3D 탭, PCD 업로드, 메쉬/편집 패널 UI
vite.config.js         /api 요청을 API 서버(3001)로 프록시
src/
  main.js              지도/탭/업로드 오케스트레이션 (앱 진입점)
  pcd.js                ASCII PCD 파서 (FIELDS x y z rgb)
  heightSlices.js       z 구간별 높이 슬라이스 레이어 생성 + 패널 렌더링
  meshify.js            점군 → 복셀 밀도 필드 → 마칭 큐브 메쉬 변환
  ply.js                메쉬 → ASCII PLY 직렬화
  view3d.js              Three.js 3D orbit 뷰어 (점군/메쉬 렌더링)
  editLayer.js           노드/링크/블록 그리기·수정·삭제 + 저장/불러오기 툴바
  geojsonApi.js           편집 레이어의 GeoJSON 저장/조회 API 클라이언트
  style.css
server/
  index.mjs               Express + lowdb API 서버 (/api/nodelink)
scripts/
  pcd-lib.mjs            PCD 생성 스크립트 공용 유틸 (rgb 패킹, ascii 저장)
  generate-sample-pcd.mjs  고정 샘플 방 PCD 생성
  generate-random-pcd.mjs  랜덤 방 PCD 여러 개 생성 (업로드 테스트용)
  pcd-to-mesh.mjs          PCD → 메쉬(PLY) 변환 CLI
public/samples/           샘플 PCD 파일들 (앱이 초기 로드에 사용)
data/nodelink.geojson      노드/링크/블록 편집 결과 GeoJSON 파일 DB
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
