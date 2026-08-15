# iPhone LiDAR 기반 실내 베이스맵 자동 생성 스튜디오 — 계획서

## 0. 개요

**목표**: iPhone LiDAR로 스캔한 3D 포인트클라우드(PCD)를 입력받아
1) 천장을 자동으로 제거해 실내 베이스맵(3D 포인트클라우드/단면)을 생성하고,
2) 그 위에 로봇이 자체 SLAM으로 만든 지도를 겹쳐서 정합·비교할 수 있는
**자동화 스튜디오**를 만든다.

**참고 자료**: [SLAM LiDAR 3D 스캐너 활용법(실내) — 공영정밀측기스카이문TV](https://www.youtube.com/watch?v=mcViiKeLPa0)
> 측량기기 업체(공영정밀측기) 채널의 장비(FJD Trion S2 핸드헬드 LiDAR 스캐너 + "FJD Trion Model" 후처리 소프트웨어) 소개 영상. 자동 자막(STT)으로 내용 확인 완료.
> - **천장 제거는 자동 평면 인식이 아니라 수동 "클리핑 박스(자르기 상자)"** 로 수행됨: 사용자가 3D 박스를 드래그해 천장·유리창 반사 등을 잘라냄 ("천장을 날려 줘야 돼요... 그게 바로 클리핑 박스인데... 자르기 상자를 클릭하시고요").
> - 별도로 "단면(cross-section)" 도구가 있어 두께를 지정해 여러 단면을 잘라낼 수 있음 — 다만 이는 토공 단면도 등 측량/토목용 범용 기능으로 보이며, 로봇 지도 제작과 직접 연결된 기능은 아님.
> - 영상 전체에서 "지도/맵", "평면도", "로봇" 관련 언급은 없음 (로봇 맥락은 이 영상 자체에 없고, 우리 프로젝트 목표로 별도 확장하는 것).
> - **시사점**: 본 프로젝트의 RANSAC 평면 검출 기반 자동 천장 제거(§3.1)는 영상에서 보여준 수동 박스 크롭을 자동화한 것으로 볼 수 있음 — 방향은 유효하며, 오히려 영상보다 자동화 수준이 높음.

**범위 확정 사항** (사용자 확인 완료):
- 최종 산출물은 "베이스맵 생성"에서 끝나지 않고, **로봇이 만든 지도를 베이스맵 위에 오버레이하는 단계까지 포함**한다.
- 오버레이는 **사후 재생(post-hoc playback)** 방식으로 시작한다. 실시간 스트리밍은 범위 밖(§6에 확장 항목으로 기록).
- 베이스맵의 형태는 **완전한 2D 벡터 도면이 아니라, 천장만 제거된 3D 포인트클라우드/단면**이다.
- `gltf-inspector`는 필수 컴포넌트가 아니다. 뷰어가 필요할 때 재사용 가능한 후보 중 하나일 뿐, 스튜디오의 핵심 파이프라인과는 무관하다.

---

## 1. 시스템 아키텍처 개요

```
[iPhone: ARKit 앱]                (기존: iPhone-lidar-slam-playground)
      │  LiDAR 스캔
      ▼
[원본 포인트클라우드]  (PointCloud2 / PLY, ARKit 좌표계)
      │
      ▼
[전처리: 천장/바닥 제거]   ← 신규 컴포넌트
  - 평면 분할(RANSAC 등)로 바닥/천장 평면 검출
  - 천장 이상 높이 포인트 제거 (높이 필터링)
  - 노이즈/이상치 제거
      │
      ▼
[베이스맵]  (천장 제거된 3D 포인트클라우드, 정규화된 좌표계)
      │
      ├─────────────────────────────┐
      ▼                              ▼
[로봇 SLAM 지도 수집]          [베이스맵 저장/버전관리]
  - 로봇이 동일 공간 주행           (재사용 가능한 "현장 기준 지도"로 보관)
  - 자체 SLAM으로 지도 생성
  (포맷은 §5.4에서 확정 필요)
      │
      ▼
[정합(registration)]   ← 신규 컴포넌트, 기존 ICP/DGR 코드 재사용 가능성 있음
  - 베이스맵 좌표계 ↔ 로봇 지도 좌표계 정합
  - 스케일/좌표계(Z-up vs Y-up 등) 정규화
      │
      ▼
[오버레이 재생 뷰어]   ← 신규 컴포넌트
  - 베이스맵 위에 로봇 지도를 겹쳐서 사후 재생
  - 타임라인 스크러버로 로봇 이동 궤적 재생
```

---

## 2. 기존 자산 재사용 분석

### iPhone-lidar-slam-playground
- ARKit 기반 iPhone 스캔 앱 → ROS2(Humble) 백엔드로 포인트클라우드 전송
- ICP / DGR 정합, GTSAM 기반 루프클로저, NDT-Transformer 디스크립터 이미 구현됨
- 출력: `PointCloud2`(`/global_map` 토픽), PLY 파일, rosbag(`.db3`)
- **재사용 포인트**:
  - 스캔 수집 파이프라인 그대로 사용 (입력 소스)
  - 이미 구현된 ICP/DGR 정합 모듈을 "베이스맵 ↔ 로봇 지도" 정합 단계에 재사용 검토
  - `ProcessPointClouds` / `GenericDescriptorGenerator` 확장 구조를 천장 제거 필터 모듈 추가 지점으로 활용 가능

### gltf-inspector
- 브라우저(TypeScript+Vite) 기반 정적 glTF/GLB 뷰어. 실시간 재생, 레이어 오버레이, 포인트클라우드 지원 여부 불확실
- **재사용 포인트**: 필수는 아니지만, three.js 기반 뷰어 코드베이스를 오버레이 재생 뷰어의 출발점으로 참고 가능 (완전 재사용보다는 UI 컴포넌트/로더 코드 일부 참고 수준으로 검토)

---

## 3. 신규 컴포넌트 정의

### 3.1 전처리: 천장/바닥 제거 모듈
- 입력: 원본 PLY/PointCloud2
- 처리:
  1. 평면 분할(RANSAC 기반 plane segmentation, 예: Open3D `segment_plane`)로 바닥면 검출 → 바닥 기준 좌표계로 정규화
  2. 바닥 기준 특정 높이 이상 포인트 제거(천장, 조명 기구 등) — 높이 임계값은 스캔 공간의 층고에 따라 자동 추정 또는 설정 가능하게
  3. 통계적 이상치 제거(statistical outlier removal)로 노이즈 정리
- 출력: 천장 제거된 포인트클라우드 = **베이스맵**
- 후보 라이브러리: Open3D (Python), 필요시 PCL
  - **구현 시 변경**: 로컬 환경이 Python 3.13이라 Open3D 휠이 아직 없어 설치 불가 → `numpy` + `scipy`(cKDTree) + `plyfile`(순수 Python PLY I/O) 조합으로 RANSAC 평면 검출/이상치 제거를 직접 구현. Open3D 지원 Python 버전이 갖춰지면 대체 검토 가능.

### 3.2 베이스맵 저장 포맷 및 좌표계 규약
- 저장 포맷: PLY(포인트클라우드) 기본, 추후 필요시 glTF POINTS 프리미티브로 내보내기 옵션 고려
- 좌표계: 스캔 공간마다 일관된 규약 필요 (예: 바닥 Z=0, 특정 기준점을 원점으로) — §6에서 확정 필요

### 3.3 로봇 지도 수집 및 정합
- 로봇이 동일 공간에서 자체 SLAM으로 생성한 지도를 베이스맵과 정합
- 정합 기법: 기존 iPhone-lidar-slam-playground의 ICP/DGR 모듈 재사용 검토 (2D occupancy grid이므로 2D ICP로 단순화 가능)
- 로봇 지도 포맷: **2D occupancy grid**(ROS/nav2 표준 pgm+yaml) + 궤적(trajectory/pose, 재생용) — §6 참고. 베이스맵(3D 포인트클라우드)과 정합하려면 베이스맵을 top-down 투영/래스터화해서 2D-2D로 비교하는 방식 검토 필요

### 3.4 오버레이 재생 뷰어 ("스튜디오" UI)
- 베이스맵(정적 배경) + 로봇 지도(시간에 따라 재생되는 레이어)를 함께 표시
- 타임라인 스크러버로 로봇 이동 궤적을 재생
- 렌더링 기술은 미확정 (three.js 자체 구축 vs gltf-inspector 코드 일부 재사용) — 개발 단계에서 프로토타입 후 결정 권장

---

## 4. 단계별 실행 계획 (문서화 이후, 개발 단계)

| Phase | 내용 | 산출물 |
|---|---|---|
| Phase 0 | 계획 문서화 (현재 단계) | 본 문서 |
| Phase 1 | 천장/바닥 제거 전처리 모듈 프로토타입 | ✅ 완료(합성 데이터 기준). `studio/preprocess.py`, `scripts/remove_ceiling.py`, `tests/test_preprocess.py` 참고 |
| Phase 2 | 베이스맵 저장/좌표계 규약 확정, 실제 iPhone 스캔으로 end-to-end 검증 | 🟡 거의 완료 — ARKitScenes(§ 아래)에 이어 **실제 iPhone 앱 스캔 결과물(.usdz, 127만 점 규모 실제 사무실)** 로도 검증 성공. 좌표계 규약(§6 질문 3)만 아직 미확정 |
| Phase 3 | 로봇 지도 포맷 확정 + 정합(registration) 모듈 구현 | ✅ 완료 — 베이스맵→2D occupancy grid 래스터화 + 2D ICP 정합까지 구현·검증 완료(아래 참고). 실제 로봇 지도 데이터로는 아직 미검증(§6 질문 4 미확정) |
| Phase 4 | 오버레이 재생 뷰어(스튜디오 UI) 프로토타입 | ✅ 완료(MVP) — `scripts/build_overlay_viewer.py`, 아래 참고. 실제 로봇 궤적 데이터로는 아직 미검증(합성 궤적으로만 확인) |
| Phase 5 | 파이프라인 자동화(스캔→베이스맵→정합→재생까지 원클릭화) | 🟡 1단계 완료 — 프로젝트 폴더+오케스트레이터(`scripts/studio.py`) 구현·검증. 아래 "스튜디오 제품 방향" 참고 |

### Phase 3 진행 상황 — 베이스맵 2D 래스터화

`studio/rasterize.py`에 구현. 방식: XY 그리드로 비닝, 셀당 (1) 바닥 높이(z ≤ `obstacle_min_height`, 기본 8cm) 포인트가 있으면 **free**, (2) 그보다 높은 포인트가 하나라도 있으면(전체 높이 컬럼 투영) **occupied**(free보다 우선), (3) 아무 포인트도 없으면 **unknown** — `nav_msgs/OccupancyGrid` 및 ROS map_server `.pgm`+`.yaml` 포맷과 호환.

```
python scripts/rasterize_base_map.py <base_map.ply> <output_prefix> --png
```

- 실제 ARKitScenes 베이스맵으로 검증: 방 벽 윤곽이 occupied로 뚜렷하게 나타나고, 내부 대부분이 free, 큰 가구/잡동사니 클러스터가 별도 occupied 덩어리로 표시됨. `obstacle_min_height` 0.08m vs 0.20m 비교 결과 거의 동일 — 기본값이 안정적.
- `tests/test_rasterize.py`로 합성 데이터 기준 free/occupied/unknown 분류 정확성 검증 완료 (PASS)
- **다음 단계**: 로봇이 생성한 실제 occupancy grid(같은 포맷)와 이 베이스맵 래스터를 2D ICP 등으로 정합하는 모듈은 아직 미구현 (§6 질문 4 확정 후 진행)
- **컬러 top-down 이미지 추가**: occupancy grid(흑백/회색, 로봇 정합용 표준 포맷이라 그대로 유지)와 별개로, `rasterize_color_topdown()`이 입력 PLY에 색이 있으면 **셀별 최고 높이 지점의 색**을 사용해 항공사진처럼 보이는 컬러 평면도를 만듦(평균이 아니라 최고점 선택 — 평균을 쓰면 가구 색이 바닥과 섞여 지저분해짐). `rasterize_base_map.py --png`가 컬러 PLY를 입력받으면 자동으로 `<prefix>_color.png`도 같이 생성. 실제 오피스 스캔으로 확인 — 카펫 색, 책상 배치, 복도까지 알아볼 수 있는 수준.

### Phase 3 진행 상황 — 2D ICP 정합

`studio/registration.py`에 구현. 두 occupancy grid의 occupied 셀 중심점을 2D 점집합으로 뽑아 point-to-point ICP(Kabsch/Procrustes 폐형해 + 최근접 대응)로 정합.

```
python scripts/register_maps.py <base_map_prefix> <robot_map_prefix> --png overlay.png
```

- **한계 발견 및 대응**: 기본 `icp_2d`는 중심점 정렬만으로 초기값을 잡기 때문에 실제 회전 오차가 ±30도를 넘으면 지역 최소값에 빠져 수렴 실패함 (합성 데이터로 15/30/45/60/90/180도 오프셋을 직접 테스트해서 확인). 로봇의 초기 방향 추정이 이보다 부정확할 수 있어, 여러 회전 시드(0/45/90/.../315도)로 ICP를 각각 돌려 RMSE가 가장 낮은 결과를 채택하는 `icp_2d_multistart`를 추가 — 15~270도 전 구간에서 정확히 수렴함을 확인.
- **검증**: (1) 합성 베이스맵에 정답 회전·이동을 가해 만든 가짜 "로봇 지도"로 ICP가 역변환을 정확히 복원하는지 확인 (`tests/test_registration.py`, PASS). (2) 실제 CLI 파이프라인(PLY→occupancy grid 저장→로드→정합→오버레이 PNG)까지 end-to-end로 실행, 벽·가구가 시각적으로 정확히 겹치는 것을 확인.
- **아직 없는 것**: 실제 로봇이 만든 occupancy grid 데이터 — §6 질문 4(로봇 지도 수집 방식) 확정 시 실제 데이터로 재검증 필요. 지금은 순수 합성 데이터로만 알고리즘을 검증한 상태.

### Phase 4 진행 상황 — 오버레이 재생 뷰어 (MVP)

`scripts/build_overlay_viewer.py` — occupancy grid(.pgm+.yaml) + 궤적(JSON, `studio/trajectory.py`의 `Pose` 리스트)을 입력받아 **단일 self-contained HTML 파일**을 만든다. 지도 PNG는 base64로, 궤적은 인라인 JSON으로 파일 안에 통째로 들어가서 서버·네트워크 없이 `file://`로 바로 열리거나 어떤 정적 서버로도 서빙 가능 — 회사 내부망 이동/USB 전달 시나리오와 일관된 설계.

```
python scripts/build_overlay_viewer.py <base_map_prefix> <output.html> [--trajectory traj.json]
```
`--trajectory` 생략 시 지도 범위 위에 왕복(lawnmower) 패턴의 합성 궤적을 자동 생성 — 실제 로봇 궤적이 없어도 뷰어 자체는 바로 확인 가능.

**기능**: 지도 배경 렌더링, 궤적 전체 경로(파란 선), 타임라인 스크러버, 재생/일시정지, 현재 위치·방향을 빨간 점+화살표로 표시, 시간/좌표/방향 텍스트 오버레이.

**브라우저로 직접 검증**: Chrome 확장을 통해 로컬 서버로 띄워서 클릭 테스트까지 완료.
- 합성 방 지도(5cm 격자)로 먼저 열었을 때 배경이 체크무늬처럼 노이즈가 껴 보이는 현상 발견 → 조사해보니 **뷰어 버그가 아니라 합성 데이터 자체의 바닥 포인트 밀도가 5cm 격자 대비 너무 희박**해서 생기는 현상(이전 `tests/test_rasterize.py` 작성 때 발견했던 것과 동일한 원인). 실제 밀도 높은 office.usdz 기반 지도로 다시 열어보니 깔끔하게 렌더링됨 — 재확인하며 원인을 오진단하지 않도록 실제 데이터로 교차검증한 사례.
- 재생 버튼 클릭 → 타임라인이 실제로 진행되고 마커가 궤적을 따라 이동하는 것까지 확인.

### 3D 오버레이 뷰어 — gltf-inspector 연동 (Phase 4 확장)

Phase 4의 2D 재생 뷰어와 별개로, **원본 스캔(usdz 텍스처 메시)과 처리된 포인트클라우드(ply)를 3D로 겹쳐서 눈으로 비교**하고 싶다는 요청에 따라 gltf-inspector([dcrobot-keen/gltf-inspector](https://github.com/dcrobot-keen/gltf-inspector))를 활용하는 경로를 추가함.

**제약 확인**: gltf-inspector 소스(`GltfAssetLoader.ts`)를 직접 읽어 확인한 결과, 표준 three.js `GLTFLoader`를 써서 POINTS 모드(mode=0) 프리미티브도 정상 렌더링하지만, `bundle.findPrimary()` 구조상 **한 번에 glTF/GLB 하나만** 불러온다. 즉 "usdz와 ply를 오버레이해서 본다" = "가젯 두 개를 하나의 glb 파일로 합친다"로 구현해야 함.

**구현**:
- `studio/usdz_import.py`에 `load_usdz_mesh()` 추가 — usdz의 메시(정점+삼각형 인덱스), UV(`primvars:st`), 내장 텍스처 이미지(zip 안의 jpg)까지 추출 (기존 `load_usdz_points()`는 정점만 뽑아 좌표 변환 로직을 공유하도록 리팩터링)
- `studio/gltf_export.py` — `trimesh` + `pygltflib`로 메시(텍스처 포함) + 포인트클라우드 레이어(들)를 하나의 `trimesh.Scene`으로 합쳐 `.glb`로 export
- `scripts/build_gltf_overlay.py` — CLI:
  ```
  python scripts/build_gltf_overlay.py --mesh scan.usdz --points base_map.ply:255,0,0 --output overlay.glb
  ```
  `--points`는 반복 가능(`경로:R,G,B` 형식), 색 생략 시 기본 팔레트 순환.

**gltf-inspector에 실제로 띄워서 검증**:
- 저장소를 로컬에 클론해 `npm install && npm run dev`(Vite)로 직접 구동, Chrome 확장으로 접속해서 확인.
- 작은 합성 큐브+포인트로 먼저 스모크 테스트(POINTS/TRIANGLES 모드가 실제로 파일에 들어가는지 `pygltflib`로도 재확인) → 파일 업로드 자동화 툴의 10MB 제한에 걸려, 실제 66MB 파일(office.usdz 메시 127만 정점/205만 삼각형 + office_base.ply 95.5만 점)은 **브라우저 안에서 `fetch()`로 직접 읽어 `<input type=file>`에 주입하는 방식**으로 우회해서 로드.
- 결과: Triangles 2,058,684 / Vertices 2,228,818(메시+포인트 합산과 정확히 일치) / Textures 1 — 정상 파싱, 로딩 279ms.
- **중요한 관찰**: 포인트 레이어를 켠 채로는 빨간 점들이 메시 표면을 완전히 덮어서 텍스처가 안 보임(포인트가 메시 정점의 부분집합이라 같은 위치에 있어서 생기는 당연한 현상, 버그 아님) — Explorer 트리의 눈 아이콘으로 포인트 레이어를 끄면 실제 텍스처(책상/바닥/벽 색상)가 입혀진 원본 스캔이 정상적으로 보임. 즉 **"동시에 겹쳐보기"보다 "레이어 토글로 비교하기"가 실질적인 사용 패턴**.
- 사소한 결함: trimesh의 glb 익스포터가 `bufferView.target`을 안 채워서 `BUFFER_VIEW_TARGET_MISSING` 힌트가 5개 뜸 — 렌더링에는 영향 없는 최하위 심각도(hint)라 방치.

**아직 안 한 것**: 텍스처 재매핑 없이 여러 usdz 메시를 합치는 경우(멀티 머티리얼)는 미검증 — 지금 사무실 스캔처럼 단일 메시/단일 텍스처 케이스만 확인됨.

**후속 개선 — 포인트클라우드 원본 색상**: 처음엔 포인트 레이어를 임의 단색(빨강)으로 표시했는데, 원본 색으로 비교하고 싶다는 요청에 따라 개선함. usdz에 정점별 컬러(`primvars:displayColor`)는 없는 것으로 확인(비어 있음) — 대신 `studio/usdz_import.py`의 `sample_vertex_colors()`가 UV로 텍스처 이미지를 샘플링해 정점별 색을 복원. `scripts/usdz_to_ply.py`가 기본으로 이 색을 저장하고, `remove_ceiling.py`가 이미 색을 그대로 통과시키는 구조라 베이스맵까지 자연스럽게 이어짐. `build_gltf_overlay.py`는 이제 `--points`에 색을 명시하지 않으면 PLY 자체의 색을 우선 사용(없으면 팔레트로 폴백). gltf-inspector에서 실제로 흰색/베이지/초록 톤으로 렌더링되는 것까지 확인함.

**아직 없는 것**: 실제 로봇 궤적 데이터 — 회사 방문 후 실제 pose 로그(예: `/odom` 또는 `/tf` 기록)를 `studio/trajectory.py`의 `Pose(t, x, y, theta)` 포맷으로 변환하는 어댑터가 필요할 수 있음(현재는 수동/직접 JSON 작성 또는 합성 생성기만 있음).

## 스튜디오 제품 방향 (§7 벤치마킹 이후 종합 제안)

Phase 1~4까지 각 기능을 개별 CLI 스크립트로 검증한 뒤, "이걸 하나의 스튜디오로 만들려면 어떤 모습이어야 하나"를 다시 정리한 결과.

**문제의식**: 지금까지 만든 6개 스크립트(`usdz_to_ply` → `remove_ceiling` → `rasterize_base_map` → `register_maps` → `build_overlay_viewer` / `build_gltf_overlay`)는 각각 잘 동작하지만, 사용자가 순서와 인자를 다 기억해서 손으로 이어붙여야 하는 상태였음 — "스튜디오"라기보단 "라이브러리".

**채택한 방향** (FJD Trion Model의 "프로젝트 생성 → 데이터 로딩 → 처리 → 확인" 흐름에서 프로젝트 폴더 개념만 차용, UI는 데스크톱 앱이 아니라 CLI+웹뷰어 조합 유지):
1. **프로젝트 폴더** — `projects/<name>/` 밑에 원본·베이스맵·지도·정합결과·뷰어가 고정된 구조로 쌓임
2. **오케스트레이터 한 번 호출** — 5단계를 손으로 잇지 않고 `studio.py process`로 한 번에
3. **결과 리포트 페이지** — 처리 끝나면 요약 수치 + 지도 2종 + 뷰어 링크를 모은 `report.html` 하나로 전체를 훑어볼 수 있게

**향후 기능 우선순위 제안** (§7 백로그 중 아직 안 한 것 기준):
1. ~~**이동 물체 제거**~~ — ✅ 구현. 아래 "Phase 5 진행 상황 — 이동 물체 제거" 참고.
2. ~~**자동/수동 분류(바닥/벽/가구)**~~ — ✅ 구현. 아래 "Phase 5 진행 상황 — 바닥/벽/가구 분류" 참고.
3. **평면절단(단면)** — "진짜 CAD 도면"이 필요해지면 그때 우선순위 상향.

### Phase 5 진행 상황 — 프로젝트 폴더 + 오케스트레이터

`scripts/studio.py` 구현. 서브커맨드 2개:
```
python scripts/studio.py new <project_name>
python scripts/studio.py process <project_name> --usdz scan.usdz [--robot-map robot_map_prefix] [--trajectory traj.json]
```
`process`가 5단계(usdz 임포트 → 천장/바닥/이상치 제거 → 2D 래스터화(흑백+컬러) → [robot-map 있으면] 정합 → 2D/3D 뷰어 생성)를 한 번에 실행하고, `projects/<name>/report.html`에 요약을 남김.

- `scripts/build_overlay_viewer.py`의 HTML 템플릿을 `studio/viewer_html.py`로 빼서 오케스트레이터와 공유(중복 방지)
- 실제 office.usdz로 end-to-end 검증: 5단계 전부 정상 실행, `report.html`에서 지도 이미지와 `viewer.html` 링크가 브라우저에서 실제로 열리는 것까지 확인
- `projects/`는 실제 스캔 파생 데이터라 `.gitignore`에 추가(`data/`, `sample_data/`와 동일한 이유)

**아직 없는 것**: `--robot-map`을 실제로 넣어서 정합까지 포함한 end-to-end 실행은 미검증(로봇 지도 데이터 자체가 아직 없음, §6 참고). 위 "향후 기능 우선순위"의 분류/단면은 오케스트레이터에 아직 통합 안 됨.

### Phase 5 진행 상황 — 이동 물체 제거

`studio/moving_objects.py`의 `remove_isolated_clusters()`로 구현.

**중요한 데이터 제약**: FJD의 "이동 물체 제거"는 원본 시계열 스캔(프레임별 시간차 비교)에서 동작하는 것으로 추정되는데, 우리가 가진 스캔 소스(iPhone 앱이 이미 정적 메시로 합쳐서 낸 .usdz)에는 프레임별 원본 데이터가 없음. 그래서 **진짜 모션 감지가 아니라 기하학적 휴리스틱**으로 구현: 정적 구조물(바닥/벽/가구)은 2D 점유 격자에서 큰 연결 컴포넌트를 이루는데, 일관성 없이 찍힌 물체는 작고 고립된 컴포넌트로 남는다는 가정. `scipy.ndimage.label`로 8-연결 컴포넌트 라벨링 후, 물리적 면적(기본 0.3m² — 사람 발딛는 면적보다 크고 웬만한 가구보다는 작게) 미만인 컴포넌트에 속한 장애물 포인트를 제거.

- **검증 (합성 데이터)**: 열린 바닥 공간에 사람 모양 클러스터(가상의 서 있는 사람, 반경 ~0.12m 표준편차, 높이 1.7m)를 주입한 뒤 정확히 제거되고 테이블(정적 구조물)은 그대로 남는 것을 확인 (`tests/test_moving_objects.py`, PASS)
- **실제 데이터로 확인한 정직한 결과**: 실제 오피스 스캔에 적용했더니, 제거된 컴포넌트들이 방 내부에 고립되어 떠 있는 형태가 아니라 **스캔 영역 경계(가장자리)를 따라 몰려있는 패턴**으로 나타남 — 즉 이 스캔에서는 "이동 물체"보다 "스캔 가장자리 재구성 노이즈"를 잡고 있을 가능성이 높음. 알고리즘 자체는 의도대로 동작하지만(작고 고립된 것을 찾음), 실제 데이터에서 그게 "사람"인지 "노이즈"인지는 이 방식만으로는 구분 불가 — 사람이 실제로 지나간 스캔으로 재검증 필요.
- **연동**: `remove_ceiling.py --remove-isolated-clusters`, `studio.py process --remove-isolated-clusters` — 오탐 위험 때문에 기본값은 꺼짐(off-by-default), 켜면 report.html에 제거 통계가 남음.

### Phase 5 진행 상황 — 바닥/벽/가구 분류

`studio/classify.py`의 `classify_floor_wall_furniture()`로 구현. 학습 데이터가 없어 규칙 기반: 바닥은 z≈0(이미 정규화된 바닥 높이) 판정, 벽은 크고 수직에 가까운 RANSAC 평면, 나머지는 가구.

**실제 데이터에서 진짜 버그 2개 발견·수정** (합성 데이터만으로는 안 드러났던 것들):

1. **책상 높이 평면 함정**: 방향을 안 가리는 일반 RANSAC이 계속 "책상 높이(~0.73m) 평면"을 최적 평면으로 찾아버림 — 사무실의 수십 개 책상이 전부 비슷한 제조 높이라 전부 합쳐서 하나의 거대한 가상 평면을 이룸. 진짜 벽보다 인라이어가 많아서 탐색 예산(반복 횟수)을 다 써버림. `fit_vertical_plane_ransac()`으로 수정 — RANSAC 3점 샘플링 단계에서부터 수직이 아닌 후보를 아예 기각(사후 필터링이 아니라 탐색 자체를 제약).
2. **작은 후보 만나면 전체 탐색이 멈추는 버그**: 벽 후보가 최소 크기 기준에 못 미치면 `break`로 전체 탐색을 끝내버렸음 — 실제 건물은 벽마다 크기가 천차만별이라, 작은 벽 하나가 기준 미달이라고 해서 그 뒤에 더 큰 진짜 벽이 없다는 뜻이 아님. `continue`로 수정(단, 그 후보의 포인트는 제거해서 무한 재탐색 방지), `max_planes`(채택된 벽 개수)와 `max_attempts`(전체 시도 횟수)를 분리해서 관리.
3. 추가로 `min_z_span`(벽은 바닥~천장까지 뻗어있어야 함) 필터 도입 — 테이블처럼 얇은 클러스터가 얕은 대각선 평면으로 우연히 "수직 통과 조건"을 만족하는 경우를 걸러냄.

**검증**:
- 합성 데이터: 정확히 4개 벽 검출, 테이블은 가구로 정확히 유지 (`tests/test_classify.py`, PASS)
- 실제 오피스 스캔: 검출된 벽을 따로 시각화하니 **실제 건물 벽선과 정확히 일치하는 곧고 긴 직선**으로 나타남(외벽 1개 + 모서리에서 만나는 파티션 벽 2개 확인). 다만 이 복잡한 다중 공간 건물의 벽 전부(추정 8~15개 구간) 중 3~5개만 검출 — 나머지는 더 짧거나 가구에 가려진 벽으로 추정, 추가 튜닝 여지 있음.

**연동**: `scripts/classify_points.py` 단독 CLI, `studio.py process --classify` — `classified.ply` + 컬러 top-down PNG를 report.html에 추가.

### Phase 1 실행 방법

```
pip install -r requirements.txt
python tests/test_preprocess.py                                 # 합성 데이터 검증
python scripts/remove_ceiling.py <input.ply> <output.ply>        # 실제/샘플 PLY 처리
```

- `studio/point_cloud_io.py` — PLY 읽기/쓰기 (plyfile 기반)
- `studio/preprocess.py` — RANSAC 평면 검출 → 바닥 정규화 → 천장 컷오프 → 통계적 이상치 제거
- `studio/synthetic_room.py` — 실제 스캔 데이터 확보 전 검증용 합성 방(바닥/천장/벽/테이블/이상치) 생성기
- **실제 LiDAR 스캔 검증 완료**: 아이폰 실물 스캔은 아직 없어, 대신 Apple 공개 데이터셋 [ARKitScenes](https://github.com/apple/ARKitScenes)(아이폰/아이패드 LiDAR로 실촬영된 실내 씬)의 샘플(`video_id 40753679`, 546K 포인트, `sample_data/arkitscenes_40753679_mesh.ply`)로 파이프라인을 검증함.
  - z-히스토그램상 바닥(raw z≈-1.6, 73,607점)·천장(raw z≈1.1, 83,492점) 스파이크가 명확히 존재했고, 파이프라인이 이를 정확히 검출해 천장 스파이크를 컷오프함 (546K → 440K 포인트).
  - 결과 이미지: `sample_data/arkitscenes_raw.png` (원본) vs `arkitscenes_base.png` (천장 제거 후)
  - **수정 완료 (당초 알려진 한계)**: 정규화 후 바닥 기준 최저점이 z≈-0.24로, 약 24cm 바닥 아래로 내려가는 잔차가 있었음. 처음엔 "평면 피팅 기울어짐"으로 추정해 RANSAC 반복 최소자승 정제를 추가했으나 효과 없었음(-0.237→-0.240, 실행 시간만 5배↑). 원인을 시각화로 재확인한 결과 방 전체의 기울기가 아니라 **가구 밑 등 국소적으로 뭉친 메시 재구성 노이즈 클러스터**였음 — 뭉쳐있어 k-NN 기반 통계적 이상치 제거로는 탐지 불가. 천장 컷오프와 대칭으로 `floor_margin`(기본 5cm) 바닥 컷오프를 추가해 해결 (`studio/preprocess.py`의 `remove_ceiling`). 결과: 바닥 최저점 -0.24m → -0.05m로 정상화, 실제 스캔에서 17,534개 노이즈 포인트 제거 확인. RANSAC 반복 정제(`refinement_passes`)는 효과가 없어 기본값을 3→1로 낮춰 비용만 줄여둠.
  - 아이폰 앱으로 직접 찍은 실제 스캔은 아직 미확보 — 확보 시 이 섹션 재검증 필요 (파라미터 튜닝 가능성 있음: `--distance-threshold`, `--ceiling-margin` 등)

### Phase 2 진행 상황 — 실제 iPhone 앱 스캔(.usdz) 검증

실제 iPhone 스캐닝 앱으로 촬영한 **사무실 스캔(office.usdz, 약 127만 정점, 20m×20m 규모 복수 공간)** 을 확보해서 검증함.

- `studio/usdz_import.py` + `scripts/usdz_to_ply.py` 추가: `usd-core`(Pixar OpenUSD 파이썬 바인딩, Python 3.13 휠 있음)로 USDZ 내부 메시를 읽어 world transform 적용 + **Y-up → Z-up 좌표 변환**까지 처리 (iPhone 스캔 앱은 보통 ARKit 관례상 Y-up으로 내보냄).
- **실제 데이터에서 심각한 버그 발견·수정**: `_refine_plane`이 `np.linalg.svd`를 기본 옵션(`full_matrices=True`)으로 호출해서, inlier가 많을 때(19만 개) (N,N) 크기의 U 행렬을 할당하려다 **272GiB 메모리 요청으로 크래시**. 지금까지 테스트한 합성 데이터·ARKitScenes 샘플은 이 정도로 큰 inlier 집합이 안 나와서 발견되지 않았던 버그. `full_matrices=False`로 수정(Vt만 쓰므로 U는 애초에 불필요) — 대규모 실제 스캔에서만 드러난 문제였음.
- 수정 후 정상 처리: 127만 점 → 95.5만 점, 천장 높이 2.68m 검출(실제 사무실 층고와 합리적으로 일치), 2D occupancy grid 래스터화까지 성공 — 여러 방으로 나뉜 복잡한 평면도와 책상/파티션으로 보이는 구조물이 그럴듯하게 나타남.
- **주의**: `office.usdz`와 이로부터 파생된 모든 파일은 회사의 실제 스캔 데이터라 `data/`를 `.gitignore`에 추가해서 커밋 대상에서 제외함 — 절대 공개 저장소에 올리면 안 됨.

---

## 5. 리스크

- **천장 제거 정확도**: 층고가 낮은 공간, 경사 천장, 조명/배관 등 돌출물이 있는 경우 단순 높이 필터링만으로는 부정확할 수 있음 → 평면 분할과의 병행 필요
- **좌표계/스케일 불일치**: ARKit, ROS(REP-103), 로봇 자체 SLAM, 뷰어(glTF 등) 간 좌표계(Z-up/Y-up, 단위) 차이로 정합 오류 발생 가능
- **로봇 지도 포맷 미확정**: §6의 결정에 따라 정합 알고리즘 및 뷰어 구조가 달라짐 — 개발 착수 전 확정 필요
- **대용량 포인트클라우드**: 브라우저 기반 재생 뷰어의 성능 한계 → 다운샘플링/LOD 전략 필요

---

## 6. 미해결 질문 (개발 착수 전 확정 필요)

1. ~~**참고 영상 재확인**~~ — ✅ 완료 (자동 자막으로 확인, §0 참고). 영상은 수동 클리핑 박스 방식이었고, 본 프로젝트의 RANSAC 자동화 방향은 유효함.
2. ~~**로봇 지도 포맷**~~ — ✅ 확정. 경로(trajectory/pose)는 사후 재생에 항상 필요하므로 별도이고, 그 위에 겹쳐 보여줄 "지도 콘텐츠"는 **2D occupancy grid**(ROS/nav2 표준 pgm+yaml)로 우선 구현. 이유: 우리 베이스맵의 top-down 투영과 같은 평면에서 직접 비교 가능, 데이터 용량이 작아 재생에 유리, 정합도 2D ICP로 비교적 단순. 3D point cloud/mesh 오버레이는 이후 확장 항목으로 보류.
3. ~~**베이스맵 좌표계 규약**~~ — ✅ 확정(불필요 판정). 애초에 "정합(registration)"을 이미 구현해뒀다는 게 핵심: `icp_2d`/`icp_2d_multistart`가 회전·이동(원점 차이)을 자동으로 찾아 정렬하므로, 베이스맵과 로봇 지도가 서로 다른 임의 원점/축을 갖고 있어도 문제없음(§7 Phase 3 진행상황의 회사 검증 가이드에도 "이동량이 크게 나와도 정상"이라고 명시함). 따라서 전역적으로 강제된 원점 규약은 불필요 — 유지하는 최소 규칙은 **바닥=Z0, 나머지(X/Y 원점·회전)는 스캔 시작 시점 그대로 유지**뿐(`normalize_to_floor`가 이미 함). 여러 베이스맵을 서로 이어붙이는 시나리오가 생기면 그때도 같은 ICP 정합으로 해결.
4. ~~**로봇 지도 수집 방식**~~ — ✅ 확정. 회사에 로봇 2대(SPOT 1대, ROS2 기반 SLAM 스택 1대) 보유 중이나 보안상 데이터 반출 불가 — 코드만 회사 내부망에서 실행해 검증하는 방식. **ROS2 기반 로봇을 1차 대상으로 확정**: nav2 표준 `nav_msgs/OccupancyGrid`/`map_server` `.pgm`+`.yaml` 출력을 그대로 사용 — 이미 만든 `studio/rasterize.py`/`studio/registration.py`가 정확히 이 포맷을 다루므로 로봇 전용 코드 추가 없이 바로 호환됨(§7-1 참고). **SPOT은 후순위로 보류** — 기본적으로 2D LiDAR/occupancy grid를 직접 생성하지 않는 로봇(뎁스카메라+GraphNav 방식)이라 별도 SLAM 스택(slam_toolbox 등) 연동이 선행되어야 함.
5. **실시간 확장 여부**: 향후 실시간 스트리밍으로 확장할 계획이 있는지 (현재는 사후 재생으로 범위 확정, 확장 시 아키텍처에 영향)
6. ~~**뷰어 기술 선택**~~ — ✅ 확정. gltf-inspector(3D 전용) 대신 **자체 2D canvas 기반 뷰어**로 시작 — 지금까지 산출물(§3.3 occupancy grid)이 2D이고 3D 오버레이는 이미 확장 항목으로 보류했으므로(§6 질문 2) 뷰어도 2D로 시작하는 게 일관적. 서버/네트워크 없이 동작하는 **단일 self-contained HTML 파일**로 빌드(맵 PNG를 base64로 임베드) — 회사 내부망 반출 제약과 동일한 이유로 포터블성을 우선.

---

## 7. 참고 소프트웨어(FJD Trion Model) 메뉴 구조 벤치마킹

Chrome 확장 연결 후 참고 영상(§0)을 직접 재생해서 후처리 소프트웨어 "FJD Trion Model"의 실제 UI를 확인함. 리본 메뉴는 4개 탭으로 구성:

**시작(Start)** — 매핑 로딩: 포인트클라우드 매핑, GNSS정렬, PPK계산, 기지국데이터, 카메라보정, 점군에 색 입히기, 컬러편집, 오르소이미지 / 포인트클라우드 처리: 이동물체제거, 점군보정, 슈퍼샘플링, 점군보완, XY트랜스포즈, 이상값제거, 법선계산, 밀도계산 / 정합(등록): 연속스캔데이터병합, 점군정렬, 병합최적화

**편집(Edit)** — 희소화, 트랙기반자르기, 데이터추출, **평면절단(단면/cross-section)**, 자동분류, 수동분류, 모델학습(ML 기반 분류), 주석추가, 삼각망구축(메싱), 등고선, 구멍메우기, 평활화, 샘플링, 폐쇄부피, 격자부피, 두시점비교

**디스플레이(Display)** — 배경색, 시점, **자르기 상자(클리핑 박스 — 천장 제거에 쓰는 그것)**, 컬러 모드(RGB/고도/시간/강도/분류/밀도/단색), 점 크기, 이동/회전 속도, 경계강화, X선, 광선강화, 융합

**파노라마 연동 뷰** — 점군/파노라마/경로 표시 토글 + 높이(Z) 측정 도구

**내보내기 포맷**: 자체 포맷(.fjdslam) 외 `.las`, `.ply`, `.pts` (모두 `.tgz`로 압축)

### 우리 스튜디오에 필요한 기능 백로그 (위 메뉴 기준 도출)

| 기능 | 상태 | 비고 |
|---|---|---|
| 이상값 제거 | ✅ 구현됨 | `remove_statistical_outliers` |
| 천장/바닥 컷오프(자르기 상자 자동화) | ✅ 구현됨 | RANSAC 기반, §3.1 |
| 2D 지도 래스터화 | ✅ 구현됨 | occupancy grid, §3.3 |
| **점군 정렬/병합(registration)** | ❌ 미구현 | Phase 3의 남은 핵심 — 로봇 지도와 베이스맵 정합에 직결 |
| 평면절단(임의 단면 슬라이스) | ❌ 미구현 | 특정 높이/방향 단면을 뽑아 2D 도면화할 때 유용 |
| 이동 물체 제거 | ✅ 구현됨(휴리스틱) | 고립 클러스터 필터, 진짜 모션 감지는 아님 — §"스튜디오 제품 방향" 참고 |
| 삼각망 구축/구멍메우기/평활화 | ❌ 미구현 | 포인트클라우드 대신 깔끔한 메시로 베이스맵을 만들고 싶을 때 |
| 자동/수동 분류(바닥/벽/가구) | ✅ 구현됨(규칙 기반) | 학습 데이터 없어 RANSAC 휴리스틱 — §"스튜디오 제품 방향" 참고 |
| XY 트랜스포즈(좌표축 스왑) | ❌ 미구현 | 유틸리티성, 좌표계 규약(§6-3) 정리할 때 같이 처리 가능 |
| 높이 측정 도구 | ❌ 미구현 | QA용, 우선순위 낮음 |
| .las 등 추가 내보내기 포맷 | ❌ 미구현 | GIS 툴 상호운용성 필요해지면 추가 |

**결론**: 가장 시급한 건 **점군/지도 정렬(registration)** — 이건 이미 §6 질문 4(로봇 지도 수집 방식)와 직결되는 다음 작업임. 그다음으로 "이동 물체 제거"가 실제 iPhone 스캔 데이터 확보 시 필요해질 가능성이 높음.

---

## 7-1. 회사 내부망 검증 가이드 (ROS2 로봇 대상)

**배경**: 로봇 데이터는 보안상 반출 불가 — 이 저장소의 **코드만** 회사 내부망에 가져가서, 거기서 실제 ROS2 로봇의 occupancy grid로 검증한다. 아래 절차는 인터넷 연결 없이 로컬에서만 동작하도록 짜여 있음(모든 의존성은 `pip install -r requirements.txt`로 사전 설치, 런타임에 외부 네트워크 호출 없음).

**1. 로봇 쪽에서 지도 내보내기** (ROS2, nav2 기준)
```
ros2 run nav2_map_server map_saver_cli -f robot_map
```
→ `robot_map.pgm` + `robot_map.yaml` 생성됨 (표준 포맷 — 우리 로더가 주석/추가 키/negate 값까지 허용하도록 이미 방어적으로 구현됨, §3.3 참고)

**2. 이 저장소 코드를 내부망으로 복사** (git clone 또는 폴더 통째로 복사, `.venv`/`__pycache__` 제외)

**3. 베이스맵 준비** — iPhone 스캔 PLY가 아직 없으면, 같은 공간을 촬영한 임의 PLY(또는 임시로 로봇 자체 3D 스캔)로 베이스맵부터 생성:
```
pip install -r requirements.txt
python scripts/remove_ceiling.py <scan.ply> base_map.ply
python scripts/rasterize_base_map.py base_map.ply base_map/map --png
```

**4. 정합 실행**
```
python scripts/register_maps.py base_map/map robot_map --png overlay.png
```
→ 콘솔에 회전각/이동량/RMSE 출력, `overlay.png`에 두 지도가 겹쳐진 그림 저장 (해석 기준: RMSE가 격자 해상도(기본 5cm)의 수 배 이내면 정합 성공으로 판단)

**체크리스트**:
- [ ] `pip install -r requirements.txt`가 내부망에서도 성공하는지 (PyPI 미러/오프라인 wheel 필요 여부 확인)
- [ ] `map_saver_cli` 출력이 우리 로더로 문제없이 읽히는지 (다른 nav2 배포판은 yaml 키가 조금씩 다를 수 있음 — 안 읽히면 에러 메시지와 함께 알려주면 로더 보강)
- [ ] `overlay.png`에서 벽/구조물이 시각적으로 잘 겹치는지

---

## 8. 참고 링크
- https://github.com/dcrobot-keen/iPhone-lidar-slam-playground
- https://github.com/dcrobot-keen/gltf-inspector
- https://www.youtube.com/watch?v=mcViiKeLPa0
