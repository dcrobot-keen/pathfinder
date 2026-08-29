// scan-to-map-studio가 ICP 정합으로 계산하는 registration_transform.json은
// {rotation_deg, translation:[tx,ty]} 형태이고, 그 의미는 "map(로봇 SLAM) 좌표 ->
// scan_basemap(스캔 베이스맵) 좌표" 방향이다:
//   scan_basemap_point = R(rotation_deg) @ map_point + translation
// (studio/tf_export.py 문서 주석 참고 -- ICP는 source=robot(map) 포인트를
// target=base(scan_basemap) 포인트에 맞춘다).
//
// vps-system의 POST /localize는 scan_basemap(=hloc world) 프레임 기준 pose를
// 돌려주므로, pathfinder가 쓰는 map 프레임으로 옮기려면 위 관계의 역변환이
// 필요하다. vps-system/ros2_ws의 vps_localizer_node.py(ROS2)는 이걸 tf2
// lookup_transform으로 자동으로 해주지만, 여기서는 ROS 없이 같은 JSON 파일을
// 직접 읽어 동일한 수학을 구현한다(doc/architecture-improvements.md 참고).
//
// 2D 지도 마커가 목적이라 z/roll/pitch는 버리고 평면 위치 + heading(yaw)만 다룬다.

/** [x, y, z, w] 쿼터니언에서 Z축 기준 yaw(라디안)만 추출한다. */
export function yawFromQuaternion([x, y, z, w]) {
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

/**
 * scan_basemap 프레임의 2D pose를 map 프레임으로 옮긴다(정합 변환의 역방향).
 * @param {{x:number, y:number, headingRad:number}} pose - scan_basemap 프레임
 * @param {{rotationDeg:number, translation:[number,number]}} calibration -
 *   scan-to-map-studio registration_transform.json을 그대로 읽은 값
 * @returns {{x:number, y:number, headingRad:number}} map 프레임 pose
 */
export function scanBasemapToMap(pose, calibration) {
  const theta = (calibration.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const [tx, ty] = calibration.translation;
  const dx = pose.x - tx;
  const dy = pose.y - ty;
  // 정방향(map->scan_basemap): [x',y'] = R(theta) @ [x,y] + [tx,ty]
  // 역방향(scan_basemap->map), 즉 R(theta)^-1 = R(-theta):
  return {
    x: cos * dx + sin * dy,
    y: -sin * dx + cos * dy,
    headingRad: pose.headingRad - theta,
  };
}

/** 테스트/디버깅용 정방향 변환(map -> scan_basemap) -- 역변환의 왕복 검증에 쓴다. */
export function mapToScanBasemap(pose, calibration) {
  const theta = (calibration.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const [tx, ty] = calibration.translation;
  return {
    x: cos * pose.x - sin * pose.y + tx,
    y: sin * pose.x + cos * pose.y + ty,
    headingRad: pose.headingRad + theta,
  };
}
