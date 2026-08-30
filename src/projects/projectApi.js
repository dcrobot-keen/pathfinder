// 프로젝트 CRUD API 클라이언트 (server/projects.mjs).
const API_URL = '/api/projects';

/** @returns {Promise<Array<{id:string,name:string,sizeX:number,sizeY:number}>>} */
export async function listProjects() {
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`프로젝트 목록 조회 실패 (${res.status})`);
  }
  return res.json();
}

/**
 * @param {{name:string, sizeX?:number, sizeY?:number}} project
 * @returns {Promise<{id:string,name:string,sizeX:number,sizeY:number}>}
 */
export async function createProject({ name, sizeX, sizeY }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sizeX, sizeY }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `프로젝트 생성 실패 (${res.status})`);
  }
  return data;
}
