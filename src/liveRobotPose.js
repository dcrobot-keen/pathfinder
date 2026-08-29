// server/index.mjs의 /api/live-pose/stream WebSocket을 구독해서, vps-system +
// scan-to-map-studio 좌표 변환(livePoseTransform.js, ROS 없이 계산됨)을 거쳐
// map 프레임으로 들어온 실제 로봇 위치를 지도 위 아이콘 마커로 표시한다.
// doc/architecture-improvements.md ② 참고.
//
// 시뮬레이션 경로 애니메이션(robotAnimation.js)과는 별개의 소스를 쓴다 --
// "지금 실제로 어디 있는지"와 "경로탐색 데모로 재생 중인지"를 섞으면 안 되므로.
// 연결은 하나만 유지하고(appShared.js의 liveRobotPoseSource), 2D 지도 탭과
// 길찾기(장애물) 탭은 이 소스를 각자의 VectorLayer로 감싸기만 한다 —
// nodeLinkSource/importedObstacleSource와 같은 공유 방식.
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { robotMarkerStyle, REFERENCE_SIZE_M } from './pathfinding/robotAnimation.js';
import { listRobots } from './robots/robotApi.js';

const RECONNECT_DELAY_MS = 2000;
const UNKNOWN_ROBOT_COLOR = '#e91e63';
// ros-chromium의 apps/sim-driver + manifests/tb3-sim.manifest.json이 쓰는 로봇 id
// 규칙("tb3-sim-01" 등, "-sim-" 또는 "sim-"/"-sim"을 포함)을 그대로 재사용한다 --
// 실제로 존재하지 않는 가상 로봇을 실제 로봇과 같은 마커로 보여주면 혼동을
// 일으키므로, 색상+점선 테두리+라벨로 구분한다(doc/architecture-improvements.md 참고).
const SIM_ROBOT_ID_RE = /(^|-)sim(-|$)/i;
const SIM_ROBOT_COLOR = '#9b59b6';

// sim-driver가 "<robotId>-truth"로 따로 올리는 ground-truth 디버그 마커(OdometryNode
// + PoseFusionNode가 실제로 뭘 보고 조향하는지와, 시뮬레이터만 아는 "진짜" 위치를
// 눈으로 비교하기 위한 것 -- 실기에는 ground truth 자체가 없다). 반투명 회색 유령
// 점으로 그려 "이건 로봇이 아니라 디버그용 참고선"임을 명확히 한다.
const TRUTH_ROBOT_ID_RE = /-truth$/i;
const TRUTH_ROBOT_COLOR = 'rgba(136, 136, 136, 0.55)';

function isSimRobotId(robotId) {
  return SIM_ROBOT_ID_RE.test(robotId);
}

function isTruthRobotId(robotId) {
  return TRUTH_ROBOT_ID_RE.test(robotId);
}

/**
 * WebSocket 연결을 시작하고 들어오는 pose로 source를 계속 갱신한다.
 * @param {import('ol/source/Vector.js').default} source
 * @returns {{ close: () => void }}
 */
export function startLiveRobotPoseTracking(source) {
  const featuresByRobotId = new Map();
  let robotsById = new Map();
  let closed = false;
  let ws = null;

  async function refreshRobots() {
    try {
      const robots = await listRobots();
      robotsById = new Map(robots.map((r) => [r.id, r]));
    } catch (err) {
      console.error('실시간 로봇 위치: 로봇 목록 조회 실패', err);
    }
  }

  function applyPose(robotId, pose) {
    let feature = featuresByRobotId.get(robotId);
    if (!feature) {
      feature = new Feature(new Point([pose.x, pose.y]));
      featuresByRobotId.set(robotId, feature);
      source.addFeature(feature);
    } else {
      feature.getGeometry().setCoordinates([pose.x, pose.y]);
    }
    const robot = robotsById.get(robotId);
    const truth = isTruthRobotId(robotId);
    const sim = !truth && isSimRobotId(robotId);
    const baseId = truth ? robotId.slice(0, -'-truth'.length) : robotId;
    feature.setStyle(
      robotMarkerStyle(
        truth ? TRUTH_ROBOT_COLOR : robot ? undefined : sim ? SIM_ROBOT_COLOR : UNKNOWN_ROBOT_COLOR,
        truth ? undefined : robot?.icon,
        {
          // 유령 마커는 로봇 자체보다 한 단계 작게 그려 "참고용"임을 크기로도 드러낸다.
          sizeMeters: truth ? REFERENCE_SIZE_M * 0.6 : robot?.sizeMeters,
          // OL Icon의 rotation은 화면 기준 시계방향(라디안), pathfinder 좌표계는
          // 수학 표준(반시계 방향이 양의 각도)이라 부호를 뒤집는다.
          rotation: -pose.headingRad,
          label: truth ? `GT · ${baseId}` : sim ? `SIM · ${robot?.name ?? robotId}` : robot?.name ?? robotId,
          dashed: sim || truth,
        }
      )
    );
  }

  function connect() {
    if (closed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/api/live-pose/stream`);
    ws.addEventListener('message', (event) => {
      const { robotId, pose } = JSON.parse(event.data);
      applyPose(robotId, pose);
    });
    ws.addEventListener('close', () => {
      if (!closed) setTimeout(connect, RECONNECT_DELAY_MS);
    });
    ws.addEventListener('error', () => ws.close());
  }

  refreshRobots();
  connect();

  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}
