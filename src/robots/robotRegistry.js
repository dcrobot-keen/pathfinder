import { listRobots, createRobot, updateRobot, deleteRobot } from './robotApi.js';
import { ROBOT_TYPES, ROBOT_ALGORITHMS, ROBOT_STATUSES, typeLabel, algorithmLabel, statusLabel, statusColor } from './robotCodes.js';
import { ROBOT_ICON_DATA_URI } from '../../shared/robotIcons.mjs';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function selectField(label, options) {
  const wrap = el('label', 'robot-field');
  wrap.appendChild(el('span', 'robot-field-label', label));
  const select = document.createElement('select');
  select.className = 'robot-input';
  options.forEach(({ value, label: optLabel }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = optLabel;
    select.appendChild(opt);
  });
  wrap.appendChild(select);
  return { wrap, select };
}

function textField(label, { multiline = false } = {}) {
  const wrap = el('label', 'robot-field');
  wrap.appendChild(el('span', 'robot-field-label', label));
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.className = 'robot-input';
  if (!multiline) input.type = 'text';
  wrap.appendChild(input);
  return { wrap, input };
}

function numberField(label, { min = 0.05, step = 0.05 } = {}) {
  const wrap = el('label', 'robot-field');
  wrap.appendChild(el('span', 'robot-field-label', label));
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'robot-input';
  input.min = String(min);
  input.step = String(step);
  wrap.appendChild(input);
  return { wrap, input };
}

// server/robots.mjs의 DEFAULT_SIZE_M / DEFAULT_SPEED_MPS와 맞춘 기본값.
const DEFAULT_SIZE_M = 0.5;
const DEFAULT_SPEED_MPS = 1.0;

/**
 * 로봇 등록 CRUD 탭을 컨테이너에 구성한다.
 * @param {HTMLElement} containerEl
 */
export function createRobotRegistryTab(containerEl) {
  containerEl.innerHTML = '';
  containerEl.classList.add('robot-registry');

  const layout = el('div', 'robot-layout');
  const formPanel = el('div', 'robot-form-panel');
  const listPanel = el('div', 'robot-list-panel');
  layout.append(formPanel, listPanel);
  containerEl.appendChild(layout);

  // --- 폼 ---
  const formTitle = el('div', 'robot-form-title', '로봇 등록');
  const nameField = textField('이름');
  const typeField = selectField('타입', ROBOT_TYPES);
  const algorithmField = selectField('길찾기 알고리즘', ROBOT_ALGORITHMS);
  const statusField = selectField('상태', ROBOT_STATUSES);
  const companyField = textField('회사');
  const descriptionField = textField('설명', { multiline: true });
  descriptionField.input.rows = 3;
  const sizeField = numberField('크기 (m, 로봇 폭/지름)', { min: 0.1, step: 0.05 });
  const speedField = numberField('이동 속도 (m/s)', { min: 0.1, step: 0.1 });

  const iconWrap = el('label', 'robot-field');
  iconWrap.appendChild(el('span', 'robot-field-label', '아이콘'));
  const iconPreview = document.createElement('img');
  iconPreview.className = 'robot-icon-preview';
  const iconInput = document.createElement('input');
  iconInput.type = 'file';
  iconInput.accept = 'image/*';
  iconWrap.append(iconPreview, iconInput);

  let editingId = null;
  let iconDataUrl = ROBOT_ICON_DATA_URI[typeField.select.value];

  iconPreview.src = iconDataUrl;

  typeField.select.addEventListener('change', () => {
    if (!iconInput.dataset.customized) {
      iconDataUrl = ROBOT_ICON_DATA_URI[typeField.select.value] || ROBOT_ICON_DATA_URI.unknown;
      iconPreview.src = iconDataUrl;
    }
  });

  iconInput.addEventListener('change', () => {
    const file = iconInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      iconDataUrl = reader.result;
      iconPreview.src = iconDataUrl;
      iconInput.dataset.customized = '1';
    };
    reader.readAsDataURL(file);
  });

  const submitBtn = el('button', 'robot-button robot-button-primary', '등록');
  const cancelBtn = el('button', 'robot-button', '취소');
  cancelBtn.style.display = 'none';
  const formStatus = el('div', 'robot-form-status');

  const buttonRow = el('div', 'robot-button-row');
  buttonRow.append(submitBtn, cancelBtn);

  formPanel.append(
    formTitle,
    nameField.wrap,
    typeField.wrap,
    algorithmField.wrap,
    statusField.wrap,
    sizeField.wrap,
    speedField.wrap,
    companyField.wrap,
    descriptionField.wrap,
    iconWrap,
    buttonRow,
    formStatus
  );

  function resetForm() {
    editingId = null;
    nameField.input.value = '';
    typeField.select.value = ROBOT_TYPES[0].value;
    algorithmField.select.value = ROBOT_ALGORITHMS[0].value;
    statusField.select.value = ROBOT_STATUSES[3].value; // standby
    sizeField.input.value = DEFAULT_SIZE_M;
    speedField.input.value = DEFAULT_SPEED_MPS;
    companyField.input.value = '';
    descriptionField.input.value = '';
    delete iconInput.dataset.customized;
    iconInput.value = '';
    iconDataUrl = ROBOT_ICON_DATA_URI[typeField.select.value];
    iconPreview.src = iconDataUrl;
    formTitle.textContent = '로봇 등록';
    submitBtn.textContent = '등록';
    cancelBtn.style.display = 'none';
  }

  function loadIntoForm(robot) {
    editingId = robot.id;
    nameField.input.value = robot.name;
    typeField.select.value = robot.type;
    algorithmField.select.value = robot.algorithm;
    statusField.select.value = robot.status;
    sizeField.input.value = robot.sizeMeters ?? DEFAULT_SIZE_M;
    speedField.input.value = robot.speedMps ?? DEFAULT_SPEED_MPS;
    companyField.input.value = robot.company || '';
    descriptionField.input.value = robot.description || '';
    iconDataUrl = robot.icon;
    iconPreview.src = robot.icon;
    iconInput.dataset.customized = '1';
    iconInput.value = '';
    formTitle.textContent = `${robot.name} 수정`;
    submitBtn.textContent = '저장';
    cancelBtn.style.display = 'block';
  }

  cancelBtn.addEventListener('click', resetForm);

  submitBtn.addEventListener('click', async () => {
    const payload = {
      name: nameField.input.value.trim(),
      type: typeField.select.value,
      algorithm: algorithmField.select.value,
      status: statusField.select.value,
      sizeMeters: parseFloat(sizeField.input.value) || DEFAULT_SIZE_M,
      speedMps: parseFloat(speedField.input.value) || DEFAULT_SPEED_MPS,
      company: companyField.input.value.trim(),
      description: descriptionField.input.value.trim(),
      icon: iconDataUrl,
    };
    if (!payload.name) {
      formStatus.textContent = '이름을 입력하세요.';
      return;
    }
    formStatus.textContent = editingId ? '저장 중...' : '등록 중...';
    try {
      if (editingId) {
        await updateRobot(editingId, payload);
      } else {
        await createRobot(payload);
      }
      formStatus.textContent = '';
      resetForm();
      await refreshList();
    } catch (err) {
      console.error(err);
      formStatus.textContent = `실패: ${err.message}`;
    }
  });

  // --- 목록 ---
  const listTitle = el('div', 'robot-list-title', '등록된 로봇');
  const cardsWrap = el('div', 'robot-cards');
  const listStatus = el('div', 'robot-form-status');
  listPanel.append(listTitle, listStatus, cardsWrap);

  function renderCard(robot) {
    const card = el('div', 'robot-card');

    const header = el('div', 'robot-card-header');
    const icon = document.createElement('img');
    icon.className = 'robot-card-icon';
    icon.src = robot.icon;
    header.appendChild(icon);

    const headerText = el('div', 'robot-card-header-text');
    headerText.appendChild(el('div', 'robot-card-name', robot.name));
    headerText.appendChild(el('div', 'robot-card-type', typeLabel(robot.type)));
    header.appendChild(headerText);

    const badge = el('div', 'robot-status-badge', statusLabel(robot.status));
    badge.style.background = statusColor(robot.status);
    header.appendChild(badge);

    card.appendChild(header);

    const meta = el('div', 'robot-card-meta');
    meta.appendChild(el('div', null, `알고리즘: ${algorithmLabel(robot.algorithm)}`));
    meta.appendChild(
      el('div', null, `크기: ${robot.sizeMeters ?? DEFAULT_SIZE_M}m / 속도: ${robot.speedMps ?? DEFAULT_SPEED_MPS}m/s`)
    );
    if (robot.company) meta.appendChild(el('div', null, `회사: ${robot.company}`));
    if (robot.description) meta.appendChild(el('div', 'robot-card-description', robot.description));
    card.appendChild(meta);

    const actions = el('div', 'robot-card-actions');
    const editBtn = el('button', 'robot-button', '수정');
    editBtn.addEventListener('click', () => loadIntoForm(robot));
    const deleteBtn = el('button', 'robot-button robot-button-danger', '삭제');
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`${robot.name}을(를) 삭제할까요?`)) return;
      try {
        await deleteRobot(robot.id);
        await refreshList();
      } catch (err) {
        console.error(err);
        listStatus.textContent = `삭제 실패: ${err.message}`;
      }
    });
    actions.append(editBtn, deleteBtn);
    card.appendChild(actions);

    return card;
  }

  async function refreshList() {
    listStatus.textContent = '불러오는 중...';
    try {
      const robots = await listRobots();
      cardsWrap.innerHTML = '';
      robots.forEach((robot) => cardsWrap.appendChild(renderCard(robot)));
      listStatus.textContent = `${robots.length}개 로봇`;
    } catch (err) {
      console.error(err);
      listStatus.textContent = `불러오기 실패: ${err.message}`;
    }
  }

  resetForm();
  refreshList();

  return { refresh: refreshList };
}
