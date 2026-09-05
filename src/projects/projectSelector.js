// 메뉴 맨 앞의 프로젝트 콤보 박스 -- 목록에서 고르면 그 프로젝트로 전환(=주소창
// ?project=<id>를 바꾸고 새로고침), "+ 새 프로젝트"로 만들면 곧바로 전환된다.
// 지도/뷰 인스턴스를 그 자리에서 다시 만드는 게 아니라 새로고침으로 전환하는
// 이유는 appShared.js 헤더 주석 참고.
import { allProjects, activeProjectId } from '../appShared.js';
import { createProject, createProjectFromSlicemap } from './projectApi.js';

function navigateToProject(id) {
  const url = new URL(location.href);
  url.searchParams.set('project', id);
  location.href = url.toString();
}

function openCreateForm(container) {
  if (container.querySelector('.project-create-form')) return; // 이미 열려있음

  const form = document.createElement('div');
  form.className = 'project-create-form';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = '프로젝트 이름';
  nameInput.className = 'project-create-input project-name-input';

  const sizeXInput = document.createElement('input');
  sizeXInput.type = 'number';
  sizeXInput.placeholder = '가로(m)';
  sizeXInput.value = '200';
  sizeXInput.min = '1';
  sizeXInput.className = 'project-create-input project-size-input';

  const sizeYInput = document.createElement('input');
  sizeYInput.type = 'number';
  sizeYInput.placeholder = '세로(m)';
  sizeYInput.value = '400';
  sizeYInput.min = '1';
  sizeYInput.className = 'project-create-input project-size-input';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'project-create-confirm';
  confirmBtn.textContent = '만들기';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'project-create-cancel';
  cancelBtn.textContent = '취소';

  const statusEl = document.createElement('span');
  statusEl.className = 'project-create-status';

  form.append(nameInput, sizeXInput, sizeYInput, confirmBtn, cancelBtn, statusEl);
  container.appendChild(form);
  nameInput.focus();

  cancelBtn.addEventListener('click', () => form.remove());

  confirmBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      statusEl.textContent = '이름을 입력하세요.';
      return;
    }
    confirmBtn.disabled = true;
    statusEl.textContent = '만드는 중...';
    try {
      const project = await createProject({
        name,
        sizeX: Number(sizeXInput.value),
        sizeY: Number(sizeYInput.value),
      });
      navigateToProject(project.id);
    } catch (err) {
      statusEl.textContent = `실패: ${err.message}`;
      confirmBtn.disabled = false;
    }
  });
}

/** @param {HTMLElement} container */
export function createProjectSelector(container) {
  container.innerHTML = '';
  container.className = 'project-selector';

  const select = document.createElement('select');
  select.className = 'project-select';
  allProjects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.sizeX}×${p.sizeY}m)`;
    if (p.id === activeProjectId) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => navigateToProject(select.value));

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'project-new-button';
  newBtn.textContent = '+ 새 프로젝트';
  newBtn.addEventListener('click', () => openCreateForm(container));

  // 스캔 지도(slicemap-v1 .json -- 정합 워크스페이스가 시뮬레이터 worlds/ 에 publish한
  // 파일)로 프로젝트를 만든다. 평면 크기와 장애물이 그 격자에서 나오고, 같은 파일을
  // 시뮬레이터가 월드로 쓰므로 로봇 좌표가 그대로 맞는다(doc/vda5050-rcs.md).
  const scanInput = document.createElement('input');
  scanInput.type = 'file';
  scanInput.accept = '.json,application/json';
  scanInput.hidden = true;
  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.className = 'project-new-button project-scan-button';
  scanBtn.textContent = '스캔 지도로 만들기';
  scanBtn.title = 'slicemap-v1 파일(예: project_20260905.slicemap.json)로 프로젝트 + 장애물 생성';
  scanBtn.addEventListener('click', () => scanInput.click());
  const scanStatus = document.createElement('span');
  scanStatus.className = 'project-create-status';
  scanInput.addEventListener('change', async () => {
    const file = scanInput.files?.[0];
    if (!file) return;
    scanBtn.disabled = true;
    scanStatus.textContent = '만드는 중...';
    try {
      const slicemap = JSON.parse(await file.text());
      const name = file.name.replace(/\.slicemap\.json$|\.json$/i, '');
      const project = await createProjectFromSlicemap({ name, slicemap });
      navigateToProject(project.id);
    } catch (err) {
      scanStatus.textContent = `실패: ${err.message}`;
      scanBtn.disabled = false;
      scanInput.value = '';
    }
  });

  container.append(select, newBtn, scanBtn, scanInput, scanStatus);
}
