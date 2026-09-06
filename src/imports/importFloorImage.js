// 도면 이미지(png/jpg) + 축척(m/px) -> 바닥 이미지만 있는 현장 프로젝트.
// 가져오기 대화상자의 'image' 분기. 서버의 from-slicemap 은 slicemap 을 요구하므로, 이미지 크기와 같은 격자의
// "전부 unknown(0)" slicemap 을 만들어 장애물 없이 바닥만 깔린 현장을 만든다. 벽은 나중에 노드/링크/블록 편집으로 그린다.
// 이미지 위 = 최대 y (floorplan.png 규약과 같다), 원점은 (0, 0).
import { createProjectFromSlicemap } from '../projects/projectApi.js';

/** 이미지 파일 -> { png: dataURL(PNG), width, height } (JPEG 는 캔버스로 PNG 변환) */
export async function fileToPngDataUrl(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('이미지를 읽을 수 없습니다')); i.src = url; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { png: c.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {File} file
 * @param {{ metersPerPixel: number, name?: string }} opts
 */
export async function importFloorImageFile(file, { metersPerPixel, name }) {
  const r = Number(metersPerPixel);
  if (!(r > 0)) throw new Error('축척(m/px)이 양수가 아닙니다.');
  const { png, width, height } = await fileToPngDataUrl(file);
  // slicemap 격자는 최대 400x400 정도가 적당하다 -- 이미지가 크면 격자 해상도를 낮춘다(바닥 이미지는 원본 그대로)
  const cellRes = Math.max(r, (Math.max(width, height) * r) / 400);
  const cols = Math.max(1, Math.round((width * r) / cellRes));
  const rows = Math.max(1, Math.round((height * r) / cellRes));
  const zeros = new Uint8Array(cols * rows);
  let bin = '';
  for (let i = 0; i < zeros.length; i += 0x8000) bin += String.fromCharCode(...zeros.subarray(i, i + 0x8000));
  const projectName = name || file.name.replace(/\.(png|jpe?g|webp)$/i, '');
  const slicemap = {
    format: 'slicemap-v1', z: 0, band: 0, resolution: cellRes, origin: [0, 0], cols, rows, data: btoa(bin),
    sources: [{ scan: projectName, method: 'floor_image', metersPerPixel: r }],
  };
  const floor = { png, meta: { format: 'floor-image-v1', resolution: r, origin: [0, 0], width_px: width, height_px: height, row0: 'max y (image top)' } };
  const project = await createProjectFromSlicemap({ name: projectName, slicemap, floor });
  return { project, sizeX: width * r, sizeY: height * r };
}
