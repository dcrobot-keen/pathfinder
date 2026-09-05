// 메뉴 맨 앞의 프로젝트 콤보 박스 -- 목록에서 고르면 그 프로젝트로 전환(=주소창
// ?project=<id>를 바꾸고 새로고침), "+ 새 프로젝트"로 만들면 곧바로 전환된다.
// 지도/뷰 인스턴스를 그 자리에서 다시 만드는 게 아니라 새로고침으로 전환하는
// 이유는 appShared.js 헤더 주석 참고.
import { allProjects, activeProjectId } from '../appShared.js';
import { createProject, createProjectFromSlicemap } from './projectApi.js';
import { openScanWizardModal } from '../scanStudio/scanWizardModal.js';

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
    const badge = p.approved ? ' [승인]' : (p.importedRoom ? ' [스캔]' : '');
    opt.textContent = `${p.name}${badge} (${p.sizeX}×${p.sizeY}m)`;
    if (p.id === activeProjectId) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => navigateToProject(select.value));

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'project-new-button';
  newBtn.textContent = '+ 새 현장';
  newBtn.title = '새로운 빈 현장 프로젝트를 생성합니다.';
  newBtn.addEventListener('click', () => openCreateForm(container));

  // 스캔 지도(slicemap-v1 .json -- 정합 워크스페이스가 시뮬레이터 worlds/ 에 publish한
  // 파일)로 프로젝트를 만든다. 평면 크기와 장애물이 그 격자에서 나오고, 같은 파일을
  // 시뮬레이터가 월드로 쓰므로 로봇 좌표가 그대로 맞는다(doc/vda5050-rcs.md).
  const scanInput = document.createElement('input');
  scanInput.type = 'file';
  scanInput.accept = '.json,.png,application/json,image/png';
  scanInput.multiple = true; // <group>.slicemap.json + (선택) <group>.floor.png + <group>.floor.json
  scanInput.hidden = true;
  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.className = 'project-new-button project-scan-button';
  scanBtn.textContent = '+ 스캔 지도';
  scanBtn.title = 'slicemap-v1 파일(예: project_20260905.slicemap.json)로 프로젝트 + 장애물 생성. 같은 이름의 .floor.png/.floor.json 을 함께 고르면 바닥 이미지도 배경으로 깐다';
  scanBtn.addEventListener('click', () => scanInput.click());
  const scanStatus = document.createElement('span');
  scanStatus.className = 'project-create-status';
  scanInput.addEventListener('change', async () => {
    const files = Array.from(scanInput.files ?? []);
    if (files.length === 0) return;
    scanBtn.disabled = true;
    scanStatus.textContent = '만드는 중...';
    try {
      const floorPng = files.find((f) => /\.floor\.png$/i.test(f.name));
      const floorJson = files.find((f) => /\.floor\.json$/i.test(f.name));
      const file = files.find((f) => /\.slicemap\.json$/i.test(f.name)) ?? files.find((f) => /\.json$/i.test(f.name) && f !== floorJson);
      if (!file) throw new Error('slicemap-v1 .json 파일이 없습니다.');
      const slicemap = JSON.parse(await file.text());
      const name = file.name.replace(/\.slicemap\.json$|\.json$/i, '');
      let floor;
      if (floorPng && floorJson) {
        const png = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(floorPng);
        });
        floor = { png, meta: JSON.parse(await floorJson.text()) };
      } else if (floorPng || floorJson) {
        throw new Error('.floor.png 와 .floor.json 은 둘 다 골라야 합니다.');
      }
      const project = await createProjectFromSlicemap({ name, slicemap, floor });
      navigateToProject(project.id);
    } catch (err) {
      scanStatus.textContent = `실패: ${err.message}`;
      scanBtn.disabled = false;
      scanInput.value = '';
    }
  });

  const wizardBtn = document.createElement('button');
  wizardBtn.type = 'button';
  wizardBtn.className = 'project-new-button project-wizard-button';
  wizardBtn.textContent = '⚡ 스캔 파이프라인';
  wizardBtn.title = 'iPhone LiDAR 스캔(.usdz) 업로드 및 베이스맵/장애물 자동 생성 마법사';
  wizardBtn.addEventListener('click', () => {
    openScanWizardModal();
  });

  container.append(select, newBtn, scanBtn, wizardBtn, scanInput, scanStatus);
}
