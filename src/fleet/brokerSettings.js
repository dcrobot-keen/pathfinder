// 설정 › VDA5050 브로커 -- 브로커 URL·토픽 접두사·구독 목록을 저장하면 서버
// (server/vda5050.mjs)가 즉시 재접속한다. 플릿 탭(M1 이전)의 왼쪽 폼을 그대로
// 옮긴 것. 로봇 표는 운영 화면의 fleetBoard.js로 갔다. doc/vda5050-rcs.md.
import { getFleetConfig, putFleetConfig, subscribeFleetStream } from './fleetApi.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(label, input) {
  const wrap = el('label', 'robot-field');
  wrap.appendChild(el('span', 'robot-field-label', label));
  wrap.appendChild(input);
  return wrap;
}

function textInput(value, placeholder = '') {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'robot-input';
  input.value = value ?? '';
  input.placeholder = placeholder;
  return input;
}

function subscriptionsToText(subs) {
  return (subs ?? []).map((s) => `${s.manufacturer}/${s.serialNumber}`).join('\n');
}
function textToSubscriptions(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [manufacturer = '+', serialNumber = '+'] = line.split('/');
      return { manufacturer: manufacturer.trim() || '+', serialNumber: serialNumber.trim() || '+' };
    });
}

export function createBrokerSettings(containerEl) {
  containerEl.classList.add('robot-registry');
  const layout = el('div', 'robot-layout');
  containerEl.appendChild(layout);

  const form = el('div', 'robot-form-panel settings-panel');
  form.appendChild(el('div', 'robot-form-title', 'VDA5050 브로커'));
  const statusLine = el('div', 'fleet-broker-status', '상태 확인 중...');
  form.appendChild(statusLine);

  const enabledWrap = el('label', 'fleet-check');
  const enabledInput = document.createElement('input');
  enabledInput.type = 'checkbox';
  enabledWrap.append(enabledInput, document.createTextNode(' 브로커에 연결'));
  form.appendChild(enabledWrap);

  const brokerInput = textInput('', 'mqtt://127.0.0.1:1883');
  form.appendChild(field('브로커 URL (mqtt:// 또는 ws://)', brokerInput));
  const ifaceInput = textInput('uagv');
  const versionInput = textInput('v2');
  const manufacturerInput = textInput('dcrobot');
  const idRow = el('div', 'fleet-id-row');
  idRow.append(field('interfaceName', ifaceInput), field('majorVersion', versionInput));
  form.appendChild(idRow);
  form.appendChild(field('RCS manufacturer (발행 헤더)', manufacturerInput));
  const subsInput = document.createElement('textarea');
  subsInput.className = 'robot-input';
  subsInput.rows = 3;
  subsInput.placeholder = '+/+\ndcrobot/tb3-sim-01';
  form.appendChild(field('구독 (한 줄에 manufacturer/serialNumber, + = 전체)', subsInput));
  const staleInput = textInput('5000');
  form.appendChild(field('오래됨 판정 (ms)', staleInput));

  const buttonRow = el('div', 'robot-button-row');
  const saveBtn = el('button', 'robot-button robot-button-primary', '저장하고 연결');
  const reloadBtn = el('button', 'robot-button', '다시 읽기');
  buttonRow.append(saveBtn, reloadBtn);
  form.appendChild(buttonRow);
  const formStatus = el('div', 'robot-form-status');
  form.appendChild(formStatus);
  layout.appendChild(form);

  // 오른쪽: M2 연결된 서비스 주소 설정 (localStorage 저장)
  const info = el('div', 'robot-form-panel settings-panel');
  info.appendChild(el('div', 'robot-form-title', '연결된 서비스 (M2)'));

  const DEFAULT_SERVICES = {
    simViewer: 'http://localhost:8767',
    studio: 'http://localhost:8000/groups',
    navBrain: 'http://localhost:5173/apps/dashboard/nav.html',
    vpsServer: 'http://localhost:8080',
  };

  let savedServices = { ...DEFAULT_SERVICES };
  try {
    const raw = localStorage.getItem('pathfinder_services_endpoints');
    if (raw) savedServices = { ...DEFAULT_SERVICES, ...JSON.parse(raw) };
  } catch {}

  const simViewerInput = textInput(savedServices.simViewer, DEFAULT_SERVICES.simViewer);
  const studioInput = textInput(savedServices.studio, DEFAULT_SERVICES.studio);
  const navBrainInput = textInput(savedServices.navBrain, DEFAULT_SERVICES.navBrain);
  const vpsServerInput = textInput(savedServices.vpsServer, DEFAULT_SERVICES.vpsServer);

  function serviceRow(label, input, desc) {
    const wrap = el('div', 'settings-service-row');
    const header = el('div', 'settings-service-header');
    header.appendChild(el('b', '', label));
    const link = el('a', 'settings-service-link', '열기 ↗');
    link.target = '_blank';
    link.rel = 'noopener';
    link.href = input.value || '#';
    input.addEventListener('input', () => { link.href = input.value || '#'; });
    header.appendChild(link);
    wrap.append(header, input);
    if (desc) wrap.appendChild(el('span', 'settings-service-desc', desc));
    return wrap;
  }

  const sList = el('div', 'settings-services');
  sList.appendChild(serviceRow('시뮬레이터 뷰어', simViewerInput, 'ros-chromium simulator (:8767)'));
  sList.appendChild(serviceRow('정합 워크스페이스', studioInput, 'scan-to-map-studio (:8000) — slicemap & floor 발행'));
  sList.appendChild(serviceRow('로봇 두뇌 (nav.html)', navBrainInput, 'ros-chromium nav.html (:5173)'));
  sList.appendChild(serviceRow('VPS 서버 URL', vpsServerInput, 'vps-system FastAPI (/localize)'));

  const saveServicesBtn = el('button', 'robot-button', '서비스 주소 저장');
  const serviceStatus = el('div', 'robot-form-status');
  saveServicesBtn.addEventListener('click', () => {
    const data = {
      simViewer: simViewerInput.value.trim() || DEFAULT_SERVICES.simViewer,
      studio: studioInput.value.trim() || DEFAULT_SERVICES.studio,
      navBrain: navBrainInput.value.trim() || DEFAULT_SERVICES.navBrain,
      vpsServer: vpsServerInput.value.trim() || DEFAULT_SERVICES.vpsServer,
    };
    try {
      localStorage.setItem('pathfinder_services_endpoints', JSON.stringify(data));
      serviceStatus.textContent = '서비스 주소가 브라우저에 저장되었습니다.';
      serviceStatus.style.color = '#2a7d2a';
      setTimeout(() => { serviceStatus.textContent = ''; }, 3000);
    } catch (e) {
      serviceStatus.textContent = `저장 실패: ${e.message}`;
      serviceStatus.style.color = '#c0392b';
    }
  });

  info.append(sList, saveServicesBtn, serviceStatus);
  layout.appendChild(info);

  let config = null;
  let brokerStatus = { connected: false, brokerUrl: null, error: null };

  function setFormStatus(text, isError = false) {
    formStatus.textContent = text;
    formStatus.style.color = isError ? '#c0392b' : '#888';
  }
  function renderBrokerStatus() {
    if (!config?.enabled) {
      statusLine.textContent = '비활성 (설정 후 "저장하고 연결")';
      statusLine.style.color = '#888';
    } else if (brokerStatus.connected) {
      statusLine.textContent = `연결됨 · ${brokerStatus.brokerUrl}`;
      statusLine.style.color = '#2a7d2a';
    } else {
      statusLine.textContent = brokerStatus.error ? `연결 실패: ${brokerStatus.error}` : '연결 중...';
      statusLine.style.color = '#c0392b';
    }
  }
  function fillForm() {
    if (!config) return;
    enabledInput.checked = config.enabled;
    brokerInput.value = config.brokerUrl;
    ifaceInput.value = config.interfaceName;
    versionInput.value = config.majorVersion;
    manufacturerInput.value = config.manufacturer;
    subsInput.value = subscriptionsToText(config.subscriptions);
    staleInput.value = String(config.staleAfterMs);
  }
  function readForm() {
    return {
      enabled: enabledInput.checked,
      brokerUrl: brokerInput.value.trim(),
      interfaceName: ifaceInput.value.trim(),
      majorVersion: versionInput.value.trim(),
      manufacturer: manufacturerInput.value.trim(),
      subscriptions: textToSubscriptions(subsInput.value),
      staleAfterMs: Number(staleInput.value),
    };
  }
  async function loadConfig() {
    try {
      const data = await getFleetConfig();
      config = data.config;
      brokerStatus = data.status;
      fillForm();
      renderBrokerStatus();
      setFormStatus('');
    } catch (err) {
      setFormStatus(`설정을 읽지 못했습니다 — ${err.message}`, true);
    }
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    setFormStatus('저장 중...');
    try {
      const data = await putFleetConfig(readForm());
      config = data.config;
      brokerStatus = data.status;
      fillForm();
      renderBrokerStatus();
      setFormStatus(config.enabled ? '저장됨. 브로커에 연결을 시도합니다.' : '저장됨 (비활성).');
    } catch (err) {
      setFormStatus(`저장 실패 — ${err.message}`, true);
    } finally {
      saveBtn.disabled = false;
    }
  });
  reloadBtn.addEventListener('click', loadConfig);

  const stream = subscribeFleetStream((msg) => {
    if (msg.type === 'snapshot' || msg.type === 'status') {
      brokerStatus = msg.status;
      renderBrokerStatus();
    }
  });
  loadConfig();

  return { destroy() { stream.close(); } };
}
