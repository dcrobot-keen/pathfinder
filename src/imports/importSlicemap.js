// 슬라이스맵 파일(+ 바닥 이미지 사이드카)로 현장 프로젝트 만들기 -- 가져오기 대화상자의 'slicemap' 분기.
// 예전 프로젝트 선택기의 "+ 스캔 지도" 버튼 로직을 옮겨 왔다. 정합 워크스페이스가 시뮬레이터 worlds/ 에 publish 한
// <group>.slicemap.json 을 그대로 받으면 평면 크기와 장애물이 그 격자에서 나오고, 같은 파일을 시뮬레이터가 월드로
// 쓰므로 로봇 좌표가 그대로 맞는다 (doc/vda5050-rcs.md).
import { createProjectFromSlicemap } from '../projects/projectApi.js';

/**
 * @param {File[]} files  .slicemap.json (또는 .json) + 선택 .floor.png/.floor.json
 * @returns {Promise<object>} 만들어진 프로젝트 (id 포함)
 */
export async function importSlicemapFiles(files) {
  const list = Array.from(files);
  const floorPng = list.find((f) => /\.floor\.png$/i.test(f.name));
  const floorJson = list.find((f) => /\.floor\.json$/i.test(f.name));
  const file = list.find((f) => /\.slicemap\.json$/i.test(f.name)) ?? list.find((f) => /\.json$/i.test(f.name) && f !== floorJson);
  if (!file) throw new Error('slicemap-v1 .json 파일이 없습니다.');
  const slicemap = JSON.parse(await file.text());
  if (slicemap?.format !== 'slicemap-v1') throw new Error(`${file.name}: slicemap-v1 형식이 아닙니다 (format=${slicemap?.format ?? '없음'})`);
  const name = file.name.replace(/\.slicemap\.json$|\.json$/i, '');
  let floor;
  if (floorPng && floorJson) {
    const png = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(floorPng);
    });
    floor = { png: /** @type {string} */ (png), meta: JSON.parse(await floorJson.text()) };
  } else if (floorPng || floorJson) {
    throw new Error('.floor.png 와 .floor.json 은 둘 다 골라야 합니다.');
  }
  return createProjectFromSlicemap({ name, slicemap, floor });
}
