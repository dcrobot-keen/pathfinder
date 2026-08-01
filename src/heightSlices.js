import WebGLVectorLayer from 'ol/layer/WebGLVector.js';

/**
 * 포인트 배열의 z(높이) 범위를 sliceHeight(m) 단위로 나눈 구간 목록을 만든다.
 * @param {Array<{z:number}>} points
 * @param {number} sliceHeight
 */
export function buildHeightBands(points, sliceHeight) {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  if (!Number.isFinite(minZ)) return [];

  const baseZ = Math.floor(minZ / sliceHeight) * sliceHeight;
  const bandCount = Math.max(1, Math.ceil((maxZ - baseZ) / sliceHeight));

  const bands = [];
  for (let i = 0; i < bandCount; i++) {
    const min = baseZ + i * sliceHeight;
    const max = min + sliceHeight;
    bands.push({ min, max, count: 0 });
  }
  for (const p of points) {
    let idx = Math.floor((p.z - baseZ) / sliceHeight);
    if (idx < 0) idx = 0;
    if (idx >= bands.length) idx = bands.length - 1;
    bands[idx].count++;
  }
  return bands;
}

/**
 * 동일한 VectorSource(포인트가 이미 채워진 상태)를 공유하는 높이 슬라이스 레이어들을 만든다.
 * 각 레이어는 WebGL filter로 자신의 z 구간에 속한 포인트만 그린다.
 * @param {import('ol/source/Vector.js').default} source
 * @param {Array<{min:number,max:number}>} bands
 */
export function createSliceLayers(source, bands) {
  return bands.map(
    (band) =>
      new WebGLVectorLayer({
        source,
        visible: false,
        filter: ['between', ['get', 'z'], band.min, band.max],
        style: {
          'circle-radius': 2.5,
          'circle-fill-color': [
            'color',
            ['get', 'r'],
            ['get', 'g'],
            ['get', 'b'],
          ],
          'circle-opacity': 1,
        },
      })
  );
}

/**
 * 슬라이스 레이어 on/off 체크박스 패널을 컨테이너에 렌더링한다.
 * @param {HTMLElement} container
 * @param {Array<{min:number,max:number,count:number}>} bands
 * @param {import('ol/layer/WebGLVector.js').default[]} sliceLayers
 * @param {{ layer: import('ol/layer.js').Layer, label: string }} rawEntry
 */
export function renderSlicePanel(container, bands, sliceLayers, rawEntry) {
  container.innerHTML = '';
  container.classList.add('slice-panel');

  const title = document.createElement('div');
  title.className = 'slice-panel-title';
  title.textContent = '높이 슬라이스 (50cm)';
  container.appendChild(title);

  function addRow(label, count, layer, checked) {
    const row = document.createElement('label');
    row.className = 'slice-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    layer.setVisible(checked);
    checkbox.addEventListener('change', () => {
      layer.setVisible(checkbox.checked);
    });

    const text = document.createElement('span');
    text.textContent = count === undefined ? label : `${label} (${count})`;

    row.appendChild(checkbox);
    row.appendChild(text);
    container.appendChild(row);
  }

  addRow(rawEntry.label, undefined, rawEntry.layer, false);

  bands.forEach((band, i) => {
    const label = `${band.min.toFixed(1)}m ~ ${band.max.toFixed(1)}m`;
    addRow(label, band.count, sliceLayers[i], i === 0);
  });
}
