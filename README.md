# scan-to-map-studio

iPhone LiDAR 실내 스캔 → 천장 제거 베이스맵 자동 생성 → 로봇 occupancy grid와 2D 정합(registration)까지의 파이프라인. 설계 배경과 의사결정 근거는 [PLAN.md](PLAN.md) 참고.

**보안 제약**: 회사 로봇(SPOT / ROS2 SLAM 스택) 데이터는 반출 불가 — 이 코드만 내부망으로 가져가서, 거기서 실제 로봇 지도로 검증하는 구조. 아래 체크리스트는 **회사 가기 전에 미리** 확인해서, 가서 막히는 일이 없게 하기 위한 것.

## 회사 가기 전 사전 체크리스트

- [ ] **회사 내부망에서 `pip install -r requirements.txt`가 될지 확인** — PyPI 접근이 막혀있는 사내망이면 여기서 막힘. 안 되면 지금(외부망에서) 아래로 wheel을 미리 받아서 USB 등으로 함께 가져갈 것:
      ```
      pip download -r requirements.txt -d vendor_wheels
      ```
      회사에서는 `pip install --no-index --find-links vendor_wheels -r requirements.txt`로 설치.
- [ ] **회사 내부망에서 `git clone git@github.com:dcrobot-keen/scan-to-map-studio.git`이 될지 확인** — GitHub 자체가 막혀있거나 SSH 키가 그 PC에 없으면 안 됨. 안 되면 USB로 이 폴더를 통째로 복사(`.git` 포함)하는 걸로 대체.
- [ ] **로봇 PC에 Python 3.9 이상이 있는지** — numpy/scipy/plyfile/matplotlib은 3.9~3.13 전 구간에서 동작. 회사 PC의 파이썬 버전을 미리 알아두면 좋음.
- [ ] **로봇 쪽에서 `ros2 run nav2_map_server map_saver_cli` 명령이 있는지** — nav2 기반이면 보통 있음. 없으면 "지도 내보내기" 부분만 그 로봇의 SLAM 스택에 맞게 대체 확인 필요.

## 빠른 시작

```
pip install -r requirements.txt
python tests/test_preprocess.py      # 천장 제거 파이프라인 자체 검증
python tests/test_rasterize.py       # occupancy grid 래스터화 자체 검증
python tests/test_registration.py    # ICP 정합 자체 검증
```
세 개 다 `PASS`가 뜨면 코드 자체는 정상 — 이제 실제 데이터로 넘어가면 됨.

## 회사에서 할 일 (실제 로봇 지도로 검증)

1. **로봇 쪽에서 지도 내보내기**
   ```
   ros2 run nav2_map_server map_saver_cli -f robot_map
   ```
   → `robot_map.pgm` + `robot_map.yaml` 생성

2. **베이스맵 준비** (iPhone으로 같은 공간을 스캔한 PLY가 있다면 그걸로, 없으면 임시로 아무 스캔 PLY로)
   ```
   python scripts/remove_ceiling.py <scan.ply> base_map.ply
   python scripts/rasterize_base_map.py base_map.ply base_map/map --png
   ```

3. **정합 실행**
   ```
   python scripts/register_maps.py base_map/map robot_map --png overlay.png
   ```
   → 콘솔에 회전각/이동량/RMSE 출력, `overlay.png`에 두 지도가 겹쳐진 그림 저장.
   판단 기준: RMSE가 격자 해상도(기본 5cm)의 수 배 이내면 정합 성공.

## 그 외 도구

- `python scripts/usdz_to_ply.py scan.usdz scan.ply` — iPhone 스캔 앱이 내보낸 .usdz를 PLY로 변환 (`usd-core` 필요)
- `python scripts/build_overlay_viewer.py <base_map_prefix> viewer.html [--trajectory traj.json]` — 베이스맵+로봇 궤적을 하나의 self-contained HTML로 만들어 재생(타임라인 스크러버) — 서버/네트워크 불필요, 더블클릭으로 바로 열림
- `python scripts/build_gltf_overlay.py --mesh scan.usdz --points base_map.ply:255,0,0 --output overlay.glb` — 원본 스캔(텍스처 메시)과 처리된 포인트클라우드를 하나의 glb로 합쳐서 [gltf-inspector](https://github.com/dcrobot-keen/gltf-inspector)로 3D 확인 (`trimesh`, `pygltflib`, `Pillow` 필요). gltf-inspector는 파일 하나만 불러오는 구조라 미리 합쳐야 함 — 자세한 내용은 PLAN.md의 "3D 오버레이 뷰어" 절 참고.

## 문제 생기면

- `pip install` 실패(오프라인) → 위 체크리스트의 `vendor_wheels` 방법 사용
- `register_maps.py`가 `robot_map.yaml`을 못 읽음 → 실제 로 나온 yaml 내용과 에러 메시지를 그대로 기록해두면, 그 사내망 nav2 배포판 차이에 맞춰 `studio/rasterize.py`의 로더를 보강할 수 있음
- 그 외 막히는 지점은 PLAN.md §6(미해결 질문)·§7-1(검증 가이드)에 이미 알려진 한계가 정리되어 있으니 먼저 확인
