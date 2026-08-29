// 여러 탭(2D 지도 / 3D 뷰 / 길찾기 두 모드)이 공유하는 좌표계와 데이터 소스.
// 하나의 VectorSource를 여러 지도 인스턴스의 레이어가 동시에 참조할 수 있으므로,
// 여기 둔 소스를 채우면 그걸 구독하는 모든 탭이 항상 최신 상태를 보여준다.
import Projection from 'ol/proj/Projection.js';
import { addProjection } from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';

// 실내 지도용 평면 좌표계: 0,0을 기점으로 m 단위, 200m(가로) x 400m(세로) 공장 부지 기준
export const MAP_SIZE_X = 200;
export const MAP_SIZE_Y = 400;
export const indoorProjection = new Projection({
  code: 'indoor-plane',
  units: 'm',
  extent: [0, 0, MAP_SIZE_X, MAP_SIZE_Y],
});
addProjection(indoorProjection);

// 컬러드 PCD 포인트 (전체/높이 슬라이스 레이어들이 공유하는 원본 소스)
export const pcdSource = new VectorSource();

// 노드/링크/블록 편집 데이터 (편집 탭과 길찾기 탭이 공유)
export const nodeLinkSource = new VectorSource();

// scan-to-map-studio에서 가져온(import) 장애물 블록. 사용자가 손으로 그린
// nodeLinkSource와는 별도로 관리해, 재가져오기(re-import)가 수동 편집 데이터를
// 절대 건드리지 않게 한다. 경로탐색 요청을 만들 때 nodeLinkSource와 합쳐서 보낸다.
export const importedObstacleSource = new VectorSource();
