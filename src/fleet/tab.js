// 플릿 (RCS) 탭 -- VDA5050 브로커 설정 + 구독 중인 로봇의 상태 표 + 즉시 동작.
// 위치 마커 자체는 2D/길찾기 탭의 liveRobotPose.js가 그대로 그린다(서버가 MQTT
// 위치를 live-pose fan-out에 합류시키므로); 이 탭은 "누가 붙어 있고, 무슨 주문을
// 수행 중이며, 오류가 무엇인지"를 보고 cancel/pause를 시키는 관제 화면이다.
// 설계: doc/vda5050-rcs.md (워크스페이스 루트).
import {
  forgetFleetRobot,
  getFleetConfig,
  listFleetRobots,
  putFleetConfig,
  sendFleetInstantAction,
  subscribeFleetStream,
} from './fleetApi.js';
import { listRobots } from '../robots/robotApi.js';

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

const CONNECTION_LABEL = {
  ONLINE: ['온라인', '#2a7d2a'],
  OFFLINE: ['오프라인', '#888'],
  CONNECTIONBROKEN: ['연결 끊김', '#c0392b'],
  UNKNOWN: ['알 수 없음', '#888'],
};

function fmtAge(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return '방금';
  if (ms < 60_000) return `${Math.round(ms / 1000)}초 전`;
  return `${Math.round(ms / 60_000)}분 전`;
}

/** 구독 목록 <-> textarea 한 줄에 `manufacturer/serialNumber` (빈 쪽은 +). */
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

export function createFleetTab(containerEl) {
  containerEl.classList.add('robot-registry');
  const layout = el('div', 'robot-layout');
  containerEl.appendChild(layout);

  // --- 왼쪽: 브로커/구독 설정 ---
  const form = el('div', 'robot-form-panel');
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

  const help = el('div', 'fleet-help');
  help.innerHTML =
    'ros-chromium의 <code>docker compose --profile nav up</code>이 mosquitto(:1883)와 sim-driver를 띄운다. ' +
    '토픽: <code>uagv/v2/&lt;manufacturer&gt;/&lt;serialNumber&gt;/{connection,state,visualization}</code>을 구독하고 ' +
    '<code>order</code>/<code>instantActions</code>를 발행한다. 길찾기 탭의 "시뮬레이터로 실행"은 로봇이 여기 온라인이면 자동으로 order로 나간다.';
  form.appendChild(help);
  layout.appendChild(form);

  // --- 오른쪽: 로봇 표 ---
  const listPanel = el('div', 'robot-list-panel');
  const listTitle = el('div', 'robot-list-title', '로봇 (0)');
  listPanel.appendChild(listTitle);
  const table = el('table', 'fleet-table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of ['로봇', '연결', '위치 (x, y, θ°) · mapId', '주문', '상태', '배터리', '오류', '마지막 수신', '동작']) headRow.appendChild(el('th', null, h));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el('tbody');
  table.appendChild(tbody);
  const tableWrap = el('div', 'fleet-table-wrap');
  tableWrap.appendChild(table);
  listPanel.appendChild(tableWrap);
  const empty = el('div', 'fleet-empty', '아직 수신한 로봇이 없습니다. 브로커에 연결되어 있고 sim-driver가 MQTT_URL로 떠 있는지 확인하세요.');
  listPanel.appendChild(empty);
  layout.appendChild(listPanel);

  // --- 상태 ---
  let config = null;
  let brokerStatus = { connected: false, brokerUrl: null, error: null };
  let staleAfterMs = 5000;
  const robots = new Map(); // key -> record
  let registryById = new Map(); // id -> robot (예전 규칙: robotId == 레지스트리 id)
  let registryBySerial = new Map(); // vda5050Serial -> robot
  let stream = null;
  let ageTimer = null;

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

  async function action(robot, actionType, button) {
    button.disabled = true;
    try {
      await sendFleetInstantAction(robot.manufacturer, robot.serialNumber, actionType);
      setFormStatus(`${robot.serialNumber}: ${actionType} 전송`);
    } catch (err) {
      setFormStatus(`${robot.serialNumber}: ${actionType} 실패 — ${err.message}`, true);
    } finally {
      button.disabled = false;
    }
  }

  function renderRobots() {
    const now = Date.now();
    const list = Array.from(robots.values()).sort((a, b) => a.key.localeCompare(b.key));
    listTitle.textContent = `로봇 (${list.length})`;
    empty.hidden = list.length > 0;
    table.hidden = list.length === 0;
    tbody.replaceChildren();
    for (const r of list) {
      const tr = el('tr');
      const registered = registryBySerial.get(r.serialNumber) ?? registryById.get(r.serialNumber);
      const age = r.lastSeen ? now - r.lastSeen : null;
      const stale = age != null && age > staleAfterMs;

      const nameTd = el('td', 'fleet-name');
      if (registered?.icon) {
        const img = document.createElement('img');
        img.src = registered.icon;
        img.className = 'fleet-icon';
        nameTd.appendChild(img);
      }
      const nameBox = el('div');
      nameBox.appendChild(el('div', 'fleet-serial', registered ? `${registered.name}` : r.serialNumber));
      nameBox.appendChild(el('div', 'fleet-sub', `${r.manufacturer}/${r.serialNumber}${registered ? ' · 등록됨' : ' · 미등록'}`));
      nameTd.appendChild(nameBox);
      tr.appendChild(nameTd);

      const [connLabel, connColor] = CONNECTION_LABEL[r.connectionState] ?? CONNECTION_LABEL.UNKNOWN;
      const connTd = el('td', null, stale && r.connectionState === 'ONLINE' ? `${connLabel} (오래됨)` : connLabel);
      connTd.style.color = stale ? '#b9770e' : connColor;
      connTd.style.fontWeight = 'bold';
      tr.appendChild(connTd);

      const p = r.position;
      tr.appendChild(el('td', 'fleet-mono', p ? `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${((p.theta * 180) / Math.PI).toFixed(0)}° · ${p.mapId ?? '-'}` : '-'));

      const s = r.state;
      const orderTd = el('td', 'fleet-mono');
      if (s?.orderId) {
        orderTd.appendChild(el('div', null, `${s.orderId.slice(0, 8)}… #${s.orderUpdateId}`));
        orderTd.appendChild(el('div', 'fleet-sub', `마지막 노드 ${s.lastNodeId || '-'} · 남은 노드 ${s.nodesLeft ?? '-'}`));
      } else if (r.lastOrder) {
        orderTd.appendChild(el('div', 'fleet-sub', `보냄 ${r.lastOrder.orderId.slice(0, 8)}… (${r.lastOrder.waypoints}점), 상태 대기`));
      } else {
        orderTd.textContent = '-';
      }
      tr.appendChild(orderTd);

      const stateText = !s ? '-' : s.paused ? '일시정지' : s.driving ? '주행 중' : s.nodesLeft ? '대기' : '유휴';
      const stateTd = el('td', null, stateText);
      if (s?.paused) stateTd.style.color = '#b9770e';
      if (s?.driving) stateTd.style.color = '#2a7d2a';
      tr.appendChild(stateTd);

      tr.appendChild(el('td', null, s?.batteryCharge != null ? `${s.batteryCharge.toFixed(0)}%${s.charging ? ' ⚡' : ''}` : '-'));

      const errTd = el('td', 'fleet-errors');
      if (s?.errors?.length) {
        for (const e of s.errors.slice(-3)) {
          const line = el('div', null, `${e.errorType}${e.errorLevel === 'FATAL' ? ' (FATAL)' : ''}`);
          line.title = e.errorDescription ?? '';
          line.style.color = e.errorLevel === 'FATAL' ? '#c0392b' : '#b9770e';
          errTd.appendChild(line);
        }
      } else {
        errTd.textContent = '-';
      }
      tr.appendChild(errTd);

      tr.appendChild(el('td', 'fleet-sub', fmtAge(age)));

      const actTd = el('td', 'fleet-actions');
      const cancelBtn = el('button', 'robot-button robot-button-danger', '취소');
      cancelBtn.title = 'cancelOrder';
      cancelBtn.addEventListener('click', () => action(r, 'cancelOrder', cancelBtn));
      const pauseBtn = el('button', 'robot-button', s?.paused ? '재개' : '일시정지');
      pauseBtn.title = s?.paused ? 'startPause' : 'stopPause';
      pauseBtn.addEventListener('click', () => action(r, s?.paused ? 'startPause' : 'stopPause', pauseBtn));
      const forgetBtn = el('button', 'robot-button', '목록에서 제거');
      forgetBtn.addEventListener('click', async () => {
        try {
          await forgetFleetRobot(r.manufacturer, r.serialNumber);
          robots.delete(r.key);
          renderRobots();
        } catch (err) {
          setFormStatus(`제거 실패 — ${err.message}`, true);
        }
      });
      const online = r.connectionState === 'ONLINE' && brokerStatus.connected;
      cancelBtn.disabled = pauseBtn.disabled = !online;
      actTd.append(cancelBtn, pauseBtn, forgetBtn);
      tr.appendChild(actTd);
      tbody.appendChild(tr);
    }
  }

  function onStream(msg) {
    if (msg.type === 'snapshot') {
      brokerStatus = msg.status;
      staleAfterMs = msg.staleAfterMs ?? staleAfterMs;
      robots.clear();
      for (const r of msg.robots) robots.set(r.key, r);
    } else if (msg.type === 'robot') {
      // 서버가 처음 보는 로봇을 레지스트리에 자동 등록하므로 잠깐 뒤 다시 읽는다.
      if (!robots.has(msg.robot.key)) setTimeout(() => loadRegistry().then(renderRobots), 800);
      robots.set(msg.robot.key, msg.robot);
    } else if (msg.type === 'status') {
      brokerStatus = msg.status;
    } else if (msg.type === 'forget') {
      robots.delete(msg.key);
    }
    renderBrokerStatus();
    renderRobots();
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

  async function loadRegistry() {
    try {
      const list = await listRobots();
      registryById = new Map(list.map((r) => [r.id, r]));
      registryBySerial = new Map(list.filter((r) => r.vda5050Serial).map((r) => [r.vda5050Serial, r]));
    } catch {
      /* 레지스트리 없이도 표는 뜬다 */
    }
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    setFormStatus('저장 중...');
    try {
      const data = await putFleetConfig(readForm());
      config = data.config;
      brokerStatus = data.status;
      staleAfterMs = config.staleAfterMs;
      fillForm();
      renderBrokerStatus();
      renderRobots();
      setFormStatus(config.enabled ? '저장됨. 브로커에 연결을 시도합니다.' : '저장됨 (비활성).');
    } catch (err) {
      setFormStatus(`저장 실패 — ${err.message}`, true);
    } finally {
      saveBtn.disabled = false;
    }
  });
  reloadBtn.addEventListener('click', () => {
    loadConfig();
    listFleetRobots()
      .then((data) => {
        robots.clear();
        for (const r of data.robots) robots.set(r.key, r);
        brokerStatus = data.status;
        staleAfterMs = data.staleAfterMs ?? staleAfterMs;
        renderBrokerStatus();
        renderRobots();
      })
      .catch(() => {});
  });

  loadRegistry().then(() => {
    loadConfig();
    stream = subscribeFleetStream(onStream);
  });
  ageTimer = setInterval(renderRobots, 2000); // "n초 전" + 오래됨 표시 갱신

  return {
    destroy() {
      stream?.close();
      clearInterval(ageTimer);
    },
  };
}
