import {
  listRobots,
  createRobot,
  updateRobot,
  deleteRobot,
  listRobotModels,
  createRobotModel,
  updateRobotModel,
  deleteRobotModel,
} from './robotApi.js';
import {
  ROBOT_TYPES,
  ROBOT_ALGORITHMS,
  ROBOT_STATUSES,
  typeLabel,
  algorithmLabel,
  statusLabel,
  statusColor,
} from './robotCodes.js';
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

function textField(label, { multiline = false, placeholder = '' } = {}) {
  const wrap = el('label', 'robot-field');
  wrap.appendChild(el('span', 'robot-field-label', label));
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.className = 'robot-input';
  if (!multiline) input.type = 'text';
  if (placeholder) input.placeholder = placeholder;
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

const DEFAULT_SIZE_M = 0.5;
const DEFAULT_SPEED_MPS = 1.0;

/**
 * 로봇 관리 탭 (기기 목록 Fleet vs 모델 카탈로그 Catalog 분리)
 * @param {HTMLElement} containerEl
 */
export function createRobotRegistryTab(containerEl) {
  containerEl.innerHTML = '';
  containerEl.classList.add('robot-registry');

  // --- 상단 서브 탭 네비게이션 ---
  const navBar = el('div', 'robot-nav-bar');
  const btnDevices = el('button', 'robot-nav-btn active');
  btnDevices.innerHTML = `<span>🤖 등록된 로봇 기기 (Fleet)</span><span class="robot-nav-badge" id="badge-devices-cnt">0</span>`;
  const btnModels = el('button', 'robot-nav-btn');
  btnModels.innerHTML = `<span>📐 로봇 모델 사양 (Catalog)</span><span class="robot-nav-badge" id="badge-models-cnt">0</span>`;
  navBar.append(btnDevices, btnModels);
  containerEl.appendChild(navBar);

  const mainWrap = el('div', 'robot-views-wrap');
  containerEl.appendChild(mainWrap);

  let activeSubTab = 'devices';
  let cachedModels = [];
  let cachedRobots = [];

  function setSubTab(tabKey) {
    activeSubTab = tabKey;
    btnDevices.classList.toggle('active', tabKey === 'devices');
    btnModels.classList.toggle('active', tabKey === 'models');
    devicesView.style.display = tabKey === 'devices' ? 'flex' : 'none';
    modelsView.style.display = tabKey === 'models' ? 'flex' : 'none';
  }

  btnDevices.addEventListener('click', () => setSubTab('devices'));
  btnModels.addEventListener('click', () => setSubTab('models'));

  // =========================================================================
  // VIEW 1: 등록된 로봇 기기 (Fleet Devices)
  // =========================================================================
  const devicesView = el('div', 'robot-layout');
  const devFormPanel = el('div', 'robot-form-panel');
  const devListPanel = el('div', 'robot-list-panel');
  devicesView.append(devFormPanel, devListPanel);

  const devFormTitle = el('div', 'robot-form-title', '로봇 기기 등록');
  const devNameField = textField('기기 이름 / 식별자', { placeholder: '예: tb3-sim-01, amr-line1-01' });
  
  // 모델 선택 드롭다운
  const devModelWrap = el('label', 'robot-field');
  devModelWrap.appendChild(el('span', 'robot-field-label', '로봇 모델 (사양 템플릿)'));
  const devModelSelect = document.createElement('select');
  devModelSelect.className = 'robot-input';
  devModelWrap.appendChild(devModelSelect);

  // 선택된 모델 사양 실시간 미리보기 카드
  const devModelPreview = el('div', 'robot-model-preview-card');
  const previewHeader = el('div', 'robot-model-preview-header');
  const previewIcon = document.createElement('img');
  previewIcon.className = 'robot-model-preview-icon';
  const previewHeaderText = el('div', 'robot-model-preview-header-text');
  const previewName = el('div', 'robot-model-preview-name', '-');
  const previewMfg = el('div', 'robot-model-preview-mfg', '-');
  previewHeaderText.append(previewName, previewMfg);
  previewHeader.append(previewIcon, previewHeaderText);

  const previewSpecs = el('div', 'robot-model-preview-specs');
  previewSpecs.innerHTML = `<div>크기: -</div><div>속도: -</div><div>알고리즘: -</div><div>타입: -</div>`;
  devModelPreview.append(previewHeader, previewSpecs);

  function updateModelPreview() {
    const selectedId = devModelSelect.value;
    const model = cachedModels.find((m) => m.id === selectedId) || cachedModels[0];
    if (!model) {
      devModelPreview.style.display = 'none';
      return;
    }
    devModelPreview.style.display = 'flex';
    previewIcon.src = model.icon || ROBOT_ICON_DATA_URI[model.type] || ROBOT_ICON_DATA_URI.unknown;
    previewName.textContent = model.name;
    previewMfg.textContent = model.manufacturer || '제조사 미지정';
    previewSpecs.innerHTML = `
      <div><strong>크기:</strong> ø${model.sizeMeters ?? DEFAULT_SIZE_M}m</div>
      <div><strong>최고속도:</strong> ${model.speedMps ?? DEFAULT_SPEED_MPS}m/s</div>
      <div><strong>알고리즘:</strong> ${algorithmLabel(model.algorithm)}</div>
      <div><strong>타입:</strong> ${typeLabel(model.type)}</div>
    `;
  }
  devModelSelect.addEventListener('change', updateModelPreview);

  const devStatusField = selectField('운영 상태', ROBOT_STATUSES);
  const devVdaSerialField = textField('VDA5050 serialNumber (선택)', { placeholder: '예: tb3-sim-01' });
  const devVdaMfgField = textField('VDA5050 manufacturer (선택)', { placeholder: '예: dcrobot, ROBOTIS' });
  const devDescField = textField('설명 / 배속 위치', { multiline: true, placeholder: '설치 라인 또는 운용 메모' });
  devDescField.input.rows = 2;

  let devEditingId = null;
  const devSubmitBtn = el('button', 'robot-button robot-button-primary', '기기 등록');
  const devCancelBtn = el('button', 'robot-button', '취소');
  devCancelBtn.style.display = 'none';
  const devFormStatus = el('div', 'robot-form-status');
  const devButtonRow = el('div', 'robot-button-row');
  devButtonRow.append(devSubmitBtn, devCancelBtn);

  devFormPanel.append(
    devFormTitle,
    devNameField.wrap,
    devModelWrap,
    devModelPreview,
    devStatusField.wrap,
    devVdaSerialField.wrap,
    devVdaMfgField.wrap,
    devDescField.wrap,
    devButtonRow,
    devFormStatus
  );

  function resetDevForm() {
    devEditingId = null;
    devNameField.input.value = '';
    if (devModelSelect.options.length > 0) {
      devModelSelect.selectedIndex = 0;
    }
    updateModelPreview();
    devStatusField.select.value = ROBOT_STATUSES[3].value; // standby
    devVdaSerialField.input.value = '';
    devVdaMfgField.input.value = '';
    devDescField.input.value = '';
    devFormTitle.textContent = '로봇 기기 등록';
    devSubmitBtn.textContent = '기기 등록';
    devCancelBtn.style.display = 'none';
  }

  function loadDevIntoForm(robot) {
    devEditingId = robot.id;
    devNameField.input.value = robot.name;
    if (robot.modelId) {
      devModelSelect.value = robot.modelId;
    }
    updateModelPreview();
    devStatusField.select.value = robot.status;
    devVdaSerialField.input.value = robot.vda5050Serial || '';
    devVdaMfgField.input.value = robot.vda5050Manufacturer || '';
    devDescField.input.value = robot.description || '';
    devFormTitle.textContent = `${robot.name} 수정`;
    devSubmitBtn.textContent = '저장';
    devCancelBtn.style.display = 'block';
  }

  devCancelBtn.addEventListener('click', resetDevForm);

  devSubmitBtn.addEventListener('click', async () => {
    const payload = {
      name: devNameField.input.value.trim(),
      modelId: devModelSelect.value,
      status: devStatusField.select.value,
      vda5050Serial: devVdaSerialField.input.value.trim(),
      vda5050Manufacturer: devVdaMfgField.input.value.trim(),
      description: devDescField.input.value.trim(),
    };
    if (!payload.name) {
      devFormStatus.textContent = '기기 이름을 입력하세요.';
      return;
    }
    devFormStatus.textContent = devEditingId ? '저장 중...' : '등록 중...';
    try {
      if (devEditingId) {
        await updateRobot(devEditingId, payload);
      } else {
        await createRobot(payload);
      }
      devFormStatus.textContent = '';
      resetDevForm();
      await refreshRobotsList();
    } catch (err) {
      console.error(err);
      devFormStatus.textContent = `실패: ${err.message}`;
    }
  });

  const devListTitle = el('div', 'robot-list-title', '등록된 로봇 기기 (Fleet)');
  const devCardsWrap = el('div', 'robot-cards');
  const devListStatus = el('div', 'robot-form-status');
  devListPanel.append(devListTitle, devListStatus, devCardsWrap);

  function renderRobotCard(robot) {
    const card = el('div', 'robot-card');

    const header = el('div', 'robot-card-header');
    const icon = document.createElement('img');
    icon.className = 'robot-card-icon';
    icon.src = robot.icon || (robot.model ? robot.model.icon : ROBOT_ICON_DATA_URI.agv_amr);
    header.appendChild(icon);

    const headerText = el('div', 'robot-card-header-text');
    headerText.appendChild(el('div', 'robot-card-name', robot.name));
    
    const modelBadge = el('span', 'robot-card-model-badge', robot.modelName || robot.model?.name || '모델 미지정');
    headerText.appendChild(modelBadge);
    header.appendChild(headerText);

    const badge = el('div', 'robot-status-badge', statusLabel(robot.status));
    badge.style.background = statusColor(robot.status);
    header.appendChild(badge);
    card.appendChild(header);

    const meta = el('div', 'robot-card-meta');
    meta.appendChild(
      el('div', null, `사양: ø${robot.sizeMeters ?? DEFAULT_SIZE_M}m | 최대 ${robot.speedMps ?? DEFAULT_SPEED_MPS}m/s | ${typeLabel(robot.type)}`)
    );
    meta.appendChild(el('div', null, `알고리즘: ${algorithmLabel(robot.algorithm)}`));
    if (robot.company) {
      meta.appendChild(el('div', null, `소속/제조: ${robot.company}`));
    }
    if (robot.vda5050Serial) {
      meta.appendChild(el('div', 'robot-card-vda', `VDA5050: ${robot.vda5050Manufacturer || '?'}/${robot.vda5050Serial}`));
    }
    if (robot.description) {
      meta.appendChild(el('div', 'robot-card-description', robot.description));
    }
    card.appendChild(meta);

    const actions = el('div', 'robot-card-actions');
    const editBtn = el('button', 'robot-button', '수정');
    editBtn.addEventListener('click', () => loadDevIntoForm(robot));
    const deleteBtn = el('button', 'robot-button robot-button-danger', '삭제');
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`${robot.name} 기기를 삭제할까요?`)) return;
      try {
        await deleteRobot(robot.id);
        await refreshRobotsList();
      } catch (err) {
        console.error(err);
        devListStatus.textContent = `삭제 실패: ${err.message}`;
      }
    });
    actions.append(editBtn, deleteBtn);
    card.appendChild(actions);

    return card;
  }

  async function refreshRobotsList() {
    devListStatus.textContent = '기기 목록 불러오는 중...';
    try {
      cachedRobots = await listRobots();
      devCardsWrap.innerHTML = '';
      cachedRobots.forEach((r) => devCardsWrap.appendChild(renderRobotCard(r)));
      devListStatus.textContent = `${cachedRobots.length}개 기기 배속 운용 중`;
      const badge = document.getElementById('badge-devices-cnt');
      if (badge) badge.textContent = String(cachedRobots.length);
    } catch (err) {
      console.error(err);
      devListStatus.textContent = `불러오기 실패: ${err.message}`;
    }
  }

  // =========================================================================
  // VIEW 2: 로봇 모델 사양 카탈로그 (Robot Models Catalog)
  // =========================================================================
  const modelsView = el('div', 'robot-layout');
  modelsView.style.display = 'none';
  const modelFormPanel = el('div', 'robot-form-panel');
  const modelListPanel = el('div', 'robot-list-panel');
  modelsView.append(modelFormPanel, modelListPanel);

  const modelFormTitle = el('div', 'robot-form-title', '로봇 모델/사양 등록');
  const modelIdField = textField('모델 고유 ID', { placeholder: '예: turtlebot3-burger, former-2-0' });
  const modelNameField = textField('모델명', { placeholder: '예: TurtleBot3 Burger' });
  const modelMfgField = textField('제조사 / 개발사', { placeholder: '예: ROBOTIS, Boston Dynamics' });
  const modelTypeField = selectField('기구학/주행 타입', ROBOT_TYPES);
  const modelAlgField = selectField('권장 길찾기 알고리즘', ROBOT_ALGORITHMS);
  const modelSizeField = numberField('안전 직경/폭 (m)', { min: 0.1, step: 0.05 });
  const modelSpeedField = numberField('최고 주행 속도 (m/s)', { min: 0.1, step: 0.1 });
  const modelDescField = textField('모델 하드웨어/센서 사양 설명', { multiline: true });
  modelDescField.input.rows = 3;

  const modelIconWrap = el('label', 'robot-field');
  modelIconWrap.appendChild(el('span', 'robot-field-label', '모델 대표 아이콘'));
  const modelIconPreview = document.createElement('img');
  modelIconPreview.className = 'robot-icon-preview';
  const modelIconInput = document.createElement('input');
  modelIconInput.type = 'file';
  modelIconInput.accept = 'image/*';
  modelIconWrap.append(modelIconPreview, modelIconInput);

  let modelEditingId = null;
  let modelIconDataUrl = ROBOT_ICON_DATA_URI[modelTypeField.select.value];
  modelIconPreview.src = modelIconDataUrl;

  modelTypeField.select.addEventListener('change', () => {
    if (!modelIconInput.dataset.customized) {
      modelIconDataUrl = ROBOT_ICON_DATA_URI[modelTypeField.select.value] || ROBOT_ICON_DATA_URI.unknown;
      modelIconPreview.src = modelIconDataUrl;
    }
  });

  modelIconInput.addEventListener('change', () => {
    const file = modelIconInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      modelIconDataUrl = reader.result;
      modelIconPreview.src = modelIconDataUrl;
      modelIconInput.dataset.customized = '1';
    };
    reader.readAsDataURL(file);
  });

  const modelSubmitBtn = el('button', 'robot-button robot-button-primary', '모델 등록');
  const modelCancelBtn = el('button', 'robot-button', '취소');
  modelCancelBtn.style.display = 'none';
  const modelFormStatus = el('div', 'robot-form-status');
  const modelButtonRow = el('div', 'robot-button-row');
  modelButtonRow.append(modelSubmitBtn, modelCancelBtn);

  modelFormPanel.append(
    modelFormTitle,
    modelIdField.wrap,
    modelNameField.wrap,
    modelMfgField.wrap,
    modelTypeField.wrap,
    modelAlgField.wrap,
    modelSizeField.wrap,
    modelSpeedField.wrap,
    modelDescField.wrap,
    modelIconWrap,
    modelButtonRow,
    modelFormStatus
  );

  function resetModelForm() {
    modelEditingId = null;
    modelIdField.input.disabled = false;
    modelIdField.input.value = '';
    modelNameField.input.value = '';
    modelMfgField.input.value = '';
    modelTypeField.select.value = ROBOT_TYPES[1].value; // agv_amr
    modelAlgField.select.value = ROBOT_ALGORITHMS[2].value; // gridastar
    modelSizeField.input.value = DEFAULT_SIZE_M;
    modelSpeedField.input.value = DEFAULT_SPEED_MPS;
    modelDescField.input.value = '';
    delete modelIconInput.dataset.customized;
    modelIconInput.value = '';
    modelIconDataUrl = ROBOT_ICON_DATA_URI[modelTypeField.select.value];
    modelIconPreview.src = modelIconDataUrl;
    modelFormTitle.textContent = '로봇 모델/사양 등록';
    modelSubmitBtn.textContent = '모델 등록';
    modelCancelBtn.style.display = 'none';
  }

  function loadModelIntoForm(model) {
    modelEditingId = model.id;
    modelIdField.input.value = model.id;
    modelIdField.input.disabled = true; // ID는 수정 불가
    modelNameField.input.value = model.name;
    modelMfgField.input.value = model.manufacturer || '';
    modelTypeField.select.value = model.type;
    modelAlgField.select.value = model.algorithm;
    modelSizeField.input.value = model.sizeMeters ?? DEFAULT_SIZE_M;
    modelSpeedField.input.value = model.speedMps ?? DEFAULT_SPEED_MPS;
    modelDescField.input.value = model.description || '';
    modelIconDataUrl = model.icon;
    modelIconPreview.src = model.icon;
    modelIconInput.dataset.customized = '1';
    modelFormTitle.textContent = `${model.name} 사양 수정`;
    modelSubmitBtn.textContent = '저장';
    modelCancelBtn.style.display = 'block';
  }

  modelCancelBtn.addEventListener('click', resetModelForm);

  modelSubmitBtn.addEventListener('click', async () => {
    const payload = {
      id: modelIdField.input.value.trim(),
      name: modelNameField.input.value.trim(),
      manufacturer: modelMfgField.input.value.trim(),
      type: modelTypeField.select.value,
      algorithm: modelAlgField.select.value,
      sizeMeters: parseFloat(modelSizeField.input.value) || DEFAULT_SIZE_M,
      speedMps: parseFloat(modelSpeedField.input.value) || DEFAULT_SPEED_MPS,
      description: modelDescField.input.value.trim(),
      icon: modelIconDataUrl,
    };
    if (!payload.name) {
      modelFormStatus.textContent = '모델명을 입력하세요.';
      return;
    }
    modelFormStatus.textContent = modelEditingId ? '저장 중...' : '등록 중...';
    try {
      if (modelEditingId) {
        await updateRobotModel(modelEditingId, payload);
      } else {
        await createRobotModel(payload);
      }
      modelFormStatus.textContent = '';
      resetModelForm();
      await refreshModelsList();
      await refreshRobotsList();
    } catch (err) {
      console.error(err);
      modelFormStatus.textContent = `실패: ${err.message}`;
    }
  });

  const modelListTitle = el('div', 'robot-list-title', '로봇 모델 사양 카탈로그 (Catalog)');
  const modelCardsWrap = el('div', 'robot-cards');
  const modelListStatus = el('div', 'robot-form-status');
  modelListPanel.append(modelListTitle, modelListStatus, modelCardsWrap);

  function renderModelCard(model) {
    const card = el('div', 'robot-card');

    const header = el('div', 'robot-card-header');
    const icon = document.createElement('img');
    icon.className = 'robot-card-icon';
    icon.src = model.icon;
    header.appendChild(icon);

    const headerText = el('div', 'robot-card-header-text');
    headerText.appendChild(el('div', 'robot-card-name', model.name));
    headerText.appendChild(el('div', 'robot-card-type', `${model.manufacturer ? model.manufacturer + ' · ' : ''}${typeLabel(model.type)}`));
    header.appendChild(headerText);

    const badge = el('div', 'robot-status-badge', model.id);
    badge.style.background = '#475569';
    header.appendChild(badge);
    card.appendChild(header);

    const meta = el('div', 'robot-card-meta');
    meta.appendChild(
      el('div', null, `하드웨어 제원: 폭/반경 ø${model.sizeMeters}m | 최고 ${model.speedMps}m/s`)
    );
    meta.appendChild(el('div', null, `권장 알고리즘: ${algorithmLabel(model.algorithm)}`));
    if (model.description) {
      meta.appendChild(el('div', 'robot-card-description', model.description));
    }

    const connectedDevices = cachedRobots.filter((r) => r.modelId === model.id);
    const chipRow = el('div', 'robot-model-chips');
    const chip = el('div', 'robot-model-chip', `배속 기기: ${connectedDevices.length}대`);
    chipRow.appendChild(chip);
    meta.appendChild(chipRow);
    card.appendChild(meta);

    const actions = el('div', 'robot-card-actions');
    const editBtn = el('button', 'robot-button', '사양 수정');
    editBtn.addEventListener('click', () => {
      setSubTab('models');
      loadModelIntoForm(model);
    });
    const deleteBtn = el('button', 'robot-button robot-button-danger', '삭제');
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`"${model.name}" 모델 사양을 카탈로그에서 삭제할까요?`)) return;
      try {
        await deleteRobotModel(model.id);
        await refreshModelsList();
      } catch (err) {
        console.error(err);
        modelListStatus.textContent = `삭제 실패: ${err.message}`;
      }
    });
    actions.append(editBtn, deleteBtn);
    card.appendChild(actions);

    return card;
  }

  async function refreshModelsList() {
    modelListStatus.textContent = '카탈로그 불러오는 중...';
    try {
      cachedModels = await listRobotModels();
      // 기기 등록 폼의 모델 드롭다운 동기화
      const currentSelected = devModelSelect.value;
      devModelSelect.innerHTML = '';
      cachedModels.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name} (${m.manufacturer || '기본'})`;
        devModelSelect.appendChild(opt);
      });
      if (currentSelected && cachedModels.some((m) => m.id === currentSelected)) {
        devModelSelect.value = currentSelected;
      }
      updateModelPreview();

      // 모델 카드 렌더링
      modelCardsWrap.innerHTML = '';
      cachedModels.forEach((m) => modelCardsWrap.appendChild(renderModelCard(m)));
      modelListStatus.textContent = `${cachedModels.length}개 모델 등록됨`;
      const badge = document.getElementById('badge-models-cnt');
      if (badge) badge.textContent = String(cachedModels.length);
    } catch (err) {
      console.error(err);
      modelListStatus.textContent = `불러오기 실패: ${err.message}`;
    }
  }

  mainWrap.append(devicesView, modelsView);

  // 초기 로드
  (async () => {
    resetDevForm();
    resetModelForm();
    await refreshModelsList();
    await refreshRobotsList();
  })();

  return {
    refresh: async () => {
      await refreshModelsList();
      await refreshRobotsList();
    },
  };
}
