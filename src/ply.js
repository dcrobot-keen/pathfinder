// 메쉬(meshify.js의 pointsToMesh 출력)를 ASCII PLY 텍스트로 직렬화한다.
// 비인덱스 삼각형 스프이므로 정점을 그대로 나열하고, 면은 순차 인덱스(0,1,2 / 3,4,5 ...)로 참조한다.

/**
 * @param {{ positions: Float32Array, colors: Float32Array, vertexCount: number, triangleCount: number }} mesh
 * @returns {string}
 */
export function meshToPlyText(mesh) {
  const { positions, colors, vertexCount, triangleCount } = mesh;

  const header = [
    'ply',
    'format ascii 1.0',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    `element face ${triangleCount}`,
    'property list uchar int vertex_indices',
    'end_header',
  ].join('\n');

  const vertexLines = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const r = Math.max(0, Math.min(255, Math.round(colors[i * 3] * 255)));
    const g = Math.max(0, Math.min(255, Math.round(colors[i * 3 + 1] * 255)));
    const b = Math.max(0, Math.min(255, Math.round(colors[i * 3 + 2] * 255)));
    vertexLines[i] = `${positions[i * 3]} ${positions[i * 3 + 1]} ${positions[i * 3 + 2]} ${r} ${g} ${b}`;
  }

  const faceLines = new Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    const base = t * 3;
    faceLines[t] = `3 ${base} ${base + 1} ${base + 2}`;
  }

  return `${header}\n${vertexLines.join('\n')}\n${faceLines.join('\n')}\n`;
}
