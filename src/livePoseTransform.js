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

/**
 * [x, y, z, w] 쿼터니언에서 **Z축이 up인 프레임**을 가정하고 Z축 기준
 * yaw(라디안)를 추출한다. vps-system의 /localize가 돌려주는 쿼터니언은 ARKit
 * 좌표계(Y-up)라 이 함수가 안 맞는다 -- ARKit pose에는 반드시
 * arkitPoseToGroundPose를 쓸 것(2026-08-30 버그 수정 참고, doc/vps-system.md).
 */
export function yawFromQuaternion([x, y, z, w]) {
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

/**
 * vps-system의 /localize가 돌려주는 raw ARKit(Y-up) pose를 scan_basemap 평면
 * 위의 2D pose로 변환한다.
 *
 * **버그 수정(2026-08-30):** 이전에는 translation[0]/[1]을 그대로 x/y로 썼는데,
 * ARKit은 Y-up이라 translation[1]은 실제로 카메라 "높이"였지 지면 좌표가
 * 아니었다(카메라를 비슷한 높이로 들고 다니면 방 안 어디서든 거의 같은 값만
 * 나와 실제 위치를 구분 못 함). vps-system/pipeline/dc_vps_pipeline/
 * export_pointcloud.py가 이미 문서화한 관례대로, scan-to-map-studio/
 * registration_transform.json이 가정하는 지면 평면은 ARKit의 (X, -Z)다:
 * (x, y, z) -> (x, -z, y). heading도 같은 평면에 카메라 전방 벡터를 투영해서
 * 뽑아야 한다(쿼터니언 Z 성분만 보는 yawFromQuaternion은 Z-up 프레임 가정이라
 * 여기 안 맞음). ios-capture 앱의 RegistrationTransform.swift
 * (GroundPose.fromARKitTransform)와 동일한 수학이다.
 *
 * @param {[number, number, number]} translation - /localize의 translation [tx, ty, tz](ARKit world, Y-up)
 * @param {[number, number, number, number]} quaternion - [qx, qy, qz, qw](ARKit world 기준)
 * @returns {{x: number, y: number, headingRad: number}} scan_basemap 평면 pose
 */
export function arkitPoseToGroundPose(translation, quaternion) {
  const [qx, qy, qz, qw] = quaternion;
  const x = translation[0];
  const y = -translation[2];

  // 카메라 로컬 -Z(전방)의 world 방향. 쿼터니언->회전행렬의 "로컬 Z축의 world
  // 방향"(표준 공식의 세 번째 열)에 -1을 곱한 것과 같다.
  const forwardX = -2 * (qx * qz + qy * qw);
  const forwardZ = 2 * (qx * qx + qy * qy) - 1;
  const headingRad = Math.atan2(-forwardZ, forwardX);

  return { x, y, headingRad };
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
