import { Dropzone } from 's2m-ui';

export function ScanUpload() {
  return (
    <Dropzone
      label={<><b>scan.usdz</b> 드래그, 또는 클릭해서 선택</>}
      hint="iPhone 스캐닝 앱이 내보낸 .usdz 파일"
    />
  );
}

export function RobotMapUpload() {
  return (
    <Dropzone
      label={<><b>robot_map.pgm</b> + <b>robot_map.yaml</b> 드래그, 또는 클릭해서 선택</>}
      hint="nav2 map_server 표준 포맷 — 없으면 정합(registration) 단계는 건너뜁니다"
    />
  );
}

export function NoHint() {
  return <Dropzone label="파일을 여기로 드래그" />;
}
