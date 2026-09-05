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

  // 오른쪽: 지금 환경의 나머지 주소들 -- M2에서 저장 필드로 승격한다.
  const info = el('div', 'robot-form-panel settings-panel');
  info.appendChild(el('div', 'robot-form-title', '연결된 서비스'));
  const list = el('div', 'settings-services');
  list.innerHTML = `
    <div><b>브로커</b><span>ros-chromium compose <code>mosquitto</code> · 1883 (MQTT) / 9001 (WebSocket, 로봇 페이지용)</span></div>
    <div><b>시뮬레이터</b><span><a href="http://localhost:8767" target="_blank" rel="noopener">뷰어 :8767</a> · 로봇 2: <a href="http://localhost:8777" target="_blank" rel="noopener">:8777</a></span></div>
    <div><b>정합 워크스페이스</b><span><a href="http://localhost:8000/groups" target="_blank" rel="noopener">scan-to-map-studio :8000</a> — 저장하면 <code>&lt;group&gt;.slicemap.json/.floor.png</code>이 publish됨</span></div>
    <div><b>로봇 두뇌 페이지</b><span><a href="http://localhost:5173/apps/dashboard/nav.html" target="_blank" rel="noopener">nav.html :5173</a> — "Connect VDA5050"으로 이 관제에 붙는다</span></div>
    <div><b>VPS 서버</b><span>실기 전용. <code>DC_VPS_GROUP_ALIGNMENT</code>로 방별 좌표 변환을 응답에 붙인다 (M2에서 주소 저장 필드 추가)</span></div>`;
  info.appendChild(list);
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
