// 로봇 등록 폼/목록에서 쓰는 코드값 <-> 라벨 매핑. server/robots.mjs의 허용값과 일치해야 한다.
export const ROBOT_TYPES = [
  { value: 'humanoid', label: '휴머노이드' },
  { value: 'agv_amr', label: 'AGV/AMR' },
  { value: 'quadruped', label: '4족 보행 로봇' },
  { value: 'wheeled_nonholonomic', label: '4바퀴 로봇 (Non-holonomic)' },
  { value: 'unknown', label: '알 수 없음' },
];

// 코드값은 pathfinder 서버(/api/path/*)가 쓰는 algorithm 값과 동일하게 맞춘다.
export const ROBOT_ALGORITHMS = [
  { value: 'dijkstra', label: 'Dijkstra' },
  { value: 'astar', label: 'A*' },
  { value: 'gridastar', label: 'Grid A*' },
  { value: 'hybridastar', label: 'Hybrid A*' },
];

export const ROBOT_STATUSES = [
  { value: 'on_mission', label: '미션 중' },
  { value: 'charging', label: '충전 중' },
  { value: 'connection_failed', label: '연결 실패' },
  { value: 'standby', label: '대기중' },
  { value: 'broken', label: '고장' },
];

const STATUS_COLOR = {
  on_mission: '#4a90e2',
  charging: '#f5a623',
  connection_failed: '#e74c3c',
  standby: '#8fd18f',
  broken: '#888',
};

function labelOf(list, value) {
  return list.find((item) => item.value === value)?.label ?? value;
}

export const typeLabel = (value) => labelOf(ROBOT_TYPES, value);
export const algorithmLabel = (value) => labelOf(ROBOT_ALGORITHMS, value);
export const statusLabel = (value) => labelOf(ROBOT_STATUSES, value);
export const statusColor = (value) => STATUS_COLOR[value] || '#888';
