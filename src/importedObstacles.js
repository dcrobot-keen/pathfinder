import Style from 'ol/style/Style.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import { listImportedRooms, loadImportedObstacles } from './importedObstaclesApi.js';
import { importedObstacleSource } from './appShared.js';

// 사용자가 직접 그린 블록(nodeLinkStyle.js, 초록색)과 구분되도록 scan-to-map-studio에서
// 가져온 장애물은 빨간색으로, 장애물이 아닌 room-outline(참고용)은 점선 파란색으로 그린다.
const BLOCK_STYLE = new Style({
  fill: new Fill({ color: 'rgba(244,67,54,0.25)' }),
  stroke: new Stroke({ color: '#f44336', width: 2 }),
});
const ROOM_OUTLINE_STYLE = new Style({
  fill: new Fill({ color: 'rgba(33,150,243,0.05)' }),
  stroke: new Stroke({ color: '#2196f3', width: 1.5, lineDash: [6, 4] }),
});

/** kind === "block"이면 장애물 스타일, 그 외(room-outline)는 참고선 스타일. */
export function importedObstacleStyle(feature) {
  return feature.get('kind') === 'block' ? BLOCK_STYLE : ROOM_OUTLINE_STYLE;
}

/**
 * "스캔 장애물" 패널: scan-to-map-studio에서 가져온(import) 방 목록을 드롭다운으로
 * 보여주고, 선택한 방을 공유 소스(importedObstacleSource)에 불러온다. 이 소스는
 * appShared.js에서 관리되므로 여기서 부르면 이 패널을 렌더링하지 않은 다른 탭(예:
 * 길찾기 장애물 탭)의 지도에도 동일하게 반영된다.
 * @param {HTMLElement} panelEl
 * @param {import('ol/format/GeoJSON.js').default} geojsonFormat
 * @param {import('ol/Map.js').default} [map] 지정하면 불러온 뒤 그 지도를 데이터 범위로 이동시킨다.
 */
export function createImportedObstaclesPanel(panelEl, geojsonFormat, map) {
  panelEl.innerHTML = '';
  // 위치(.imported-panel)만 별도 지정하고, 내부 요소 스타일은 편집 패널과 공유한다 --
  // 이 패널이 뜨는 두 탭(2D 지도, 길찾기(장애물)) 모두 top-left가 이미 다른 패널
  // (편집 패널 / 길찾기 컨트롤 패널) 차지하고 있어서 겹치지 않게 bottom-left에 둔다.
  panelEl.classList.add('imported-panel');

  const title = document.createElement('div');
  title.className = 'edit-panel-title';
  title.textContent = '스캔 장애물 (scan-to-map-studio)';
  panelEl.appendChild(title);

  const select = document.createElement('select');
  select.className = 'pathfinding-select';
  panelEl.appendChild(select);

  const row = document.createElement('div');
  row.className = 'edit-mode-row';
  const loadBtn = document.createElement('button');
  loadBtn.className = 'edit-button edit-button-primary';
  loadBtn.textContent = '불러오기';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'edit-button';
  clearBtn.textContent = '지우기';
  row.append(loadBtn, clearBtn);
  panelEl.appendChild(row);

  const statusEl = document.createElement('div');
  statusEl.className = 'edit-status';
  panelEl.appendChild(statusEl);

  function setStatus(text) {
    statusEl.textContent = text;
  }

  async function refreshRoomList() {
    try {
      const rooms = await listImportedRooms();
      select.innerHTML = '';
      loadBtn.disabled = rooms.length === 0;
      if (rooms.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = '가져온 방 없음 (scripts/import-scan-to-map-studio.mjs 먼저 실행)';
        opt.disabled = true;
        select.appendChild(opt);
        return;
      }
      rooms.forEach((room) => {
        const opt = document.createElement('option');
        opt.value = room;
        opt.textContent = room;
        select.appendChild(opt);
      });
    } catch (err) {
      console.error(err);
      setStatus(`목록 조회 실패: ${err.message}`);
    }
  }

  loadBtn.addEventListener('click', async () => {
    const room = select.value;
    if (!room) return;
    setStatus('불러오는 중...');
    try {
      const fc = await loadImportedObstacles(room);
      importedObstacleSource.clear();
      importedObstacleSource.addFeatures(geojsonFormat.readFeatures(fc));
      setStatus(`"${room}" 불러오기 완료 (${fc.features.length}개 피처)`);
      if (map) {
        const extent = importedObstacleSource.getExtent();
        if (extent.every(Number.isFinite)) {
          map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 7 });
        }
      }
    } catch (err) {
      console.error(err);
      setStatus(`불러오기 실패: ${err.message}`);
    }
  });

  clearBtn.addEventListener('click', () => {
    importedObstacleSource.clear();
    setStatus('지도에서 지움 (가져온 파일 자체는 그대로 남아있음).');
  });

  refreshRoomList();
  return { refreshRoomList };
}
