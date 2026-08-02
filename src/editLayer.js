import VectorLayer from 'ol/layer/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Select from 'ol/interaction/Select.js';
import Snap from 'ol/interaction/Snap.js';
import { loadFeatureCollection, saveFeatureCollection } from './geojsonApi.js';
import { nodeLinkSource as source } from './appShared.js';
import { nodeLinkStyle, KIND_BY_TYPE } from './nodeLinkStyle.js';

/**
 * 지도에 노드(point)/링크(line)/블록(polygon) 편집 레이어와 툴바를 연결한다.
 * @param {import('ol/Map.js').default} map
 * @param {import('ol/proj/Projection.js').default} projection
 * @param {HTMLElement} panelEl
 */
export function createEditLayer(map, projection, panelEl) {
  const layer = new VectorLayer({ source, style: nodeLinkStyle, zIndex: 10 });
  map.addLayer(layer);

  const geojsonFormat = new GeoJSON({
    dataProjection: projection,
    featureProjection: projection,
  });

  const select = new Select({ layers: [layer] });
  const modify = new Modify({ source });
  const drawNode = new Draw({ source, type: 'Point' });
  const drawLink = new Draw({ source, type: 'LineString' });
  const drawBlock = new Draw({ source, type: 'Polygon' });
  const snap = new Snap({ source });

  for (const draw of [drawNode, drawLink, drawBlock]) {
    draw.on('drawend', (evt) => {
      evt.feature.set('kind', KIND_BY_TYPE[evt.feature.getGeometry().getType()]);
    });
  }

  [select, modify, drawNode, drawLink, drawBlock].forEach((i) => map.addInteraction(i));
  map.addInteraction(snap); // snap은 다른 인터랙션들보다 나중에 추가되어야 정상 동작

  let mode = 'none';
  function setMode(next) {
    mode = next;
    select.setActive(mode === 'none');
    modify.setActive(mode === 'modify');
    drawNode.setActive(mode === 'node');
    drawLink.setActive(mode === 'link');
    drawBlock.setActive(mode === 'block');
    snap.setActive(mode !== 'none');
    if (mode !== 'none') select.getFeatures().clear();
    renderPanel();
  }

  function deleteSelected() {
    select.getFeatures().forEach((f) => source.removeFeature(f));
    select.getFeatures().clear();
    renderPanel();
  }

  async function save() {
    setStatus('저장 중...');
    try {
      const fc = geojsonFormat.writeFeaturesObject(source.getFeatures());
      const result = await saveFeatureCollection(fc);
      setStatus(`저장 완료 (${result.featureCount}개 피처)`);
    } catch (err) {
      console.error(err);
      setStatus(`저장 실패: ${err.message}`);
    }
  }

  async function load() {
    setStatus('불러오는 중...');
    try {
      const fc = await loadFeatureCollection();
      source.clear();
      source.addFeatures(geojsonFormat.readFeatures(fc));
      setStatus(`불러오기 완료 (${fc.features.length}개 피처)`);
    } catch (err) {
      console.error(err);
      setStatus(`불러오기 실패: ${err.message}`);
    }
  }

  // --- 툴바 UI ---
  panelEl.innerHTML = '';
  panelEl.classList.add('edit-panel');

  const title = document.createElement('div');
  title.className = 'edit-panel-title';
  title.textContent = '노드/링크/블록 편집';
  panelEl.appendChild(title);

  const modeRow = document.createElement('div');
  modeRow.className = 'edit-mode-row';
  const modeButtons = {};
  [
    ['none', '탐색'],
    ['node', '노드'],
    ['link', '링크'],
    ['block', '블록'],
    ['modify', '수정'],
  ].forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.className = 'edit-button';
    btn.textContent = label;
    btn.addEventListener('click', () => setMode(key));
    modeButtons[key] = btn;
    modeRow.appendChild(btn);
  });
  panelEl.appendChild(modeRow);

  const actionRow = document.createElement('div');
  actionRow.className = 'edit-mode-row';
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'edit-button';
  deleteBtn.textContent = '선택 삭제';
  deleteBtn.addEventListener('click', deleteSelected);
  const saveBtn = document.createElement('button');
  saveBtn.className = 'edit-button edit-button-primary';
  saveBtn.textContent = '저장';
  saveBtn.addEventListener('click', save);
  const loadBtn = document.createElement('button');
  loadBtn.className = 'edit-button';
  loadBtn.textContent = '다시 불러오기';
  loadBtn.addEventListener('click', load);
  actionRow.append(deleteBtn, saveBtn, loadBtn);
  panelEl.appendChild(actionRow);

  const statusEl = document.createElement('div');
  statusEl.className = 'edit-status';
  panelEl.appendChild(statusEl);

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function renderPanel() {
    Object.entries(modeButtons).forEach(([key, btn]) => {
      btn.classList.toggle('active', key === mode);
    });
  }

  setMode('none');
  load();

  return { setMode, save, load, layer };
}
