# CI 전용 빌드 파일 (.github/workflows/stack-image.yml). robot-os-chromium 과 simulator 를 형제 폴더로 체크아웃한
# 컨텍스트(리포 루트)에서 빌드해 ghcr.io/dcrobot-keen/fleet-studio-stack 로 push 한다.
# 로컬 개발(소스 실시간 수정)은 이 파일을 쓰지 않는다 -- docker-compose.dev.yml 이 dockerfile_inline 으로 같은 내용을
# ROS_CHROMIUM_DIR(형제 저장소 체크아웃)를 컨텍스트 삼아 직접 빌드한다. 두 정의가 갈라지면 여기와 그쪽을 같이 고칠 것.
FROM node:22-alpine
WORKDIR /app
COPY simulator/package.json simulator/package-lock.json ./simulator/
RUN cd simulator && npm ci --omit=dev
COPY robot-os-chromium/package.json robot-os-chromium/package-lock.json ./robot-os-chromium/
COPY robot-os-chromium/packages/bus/package.json                ./robot-os-chromium/packages/bus/
COPY robot-os-chromium/packages/device-abstraction/package.json ./robot-os-chromium/packages/device-abstraction/
COPY robot-os-chromium/packages/nodes/package.json              ./robot-os-chromium/packages/nodes/
COPY robot-os-chromium/packages/planner-wasm/package.json       ./robot-os-chromium/packages/planner-wasm/
COPY robot-os-chromium/packages/rtc/package.json                ./robot-os-chromium/packages/rtc/
COPY robot-os-chromium/packages/transport/package.json          ./robot-os-chromium/packages/transport/
COPY robot-os-chromium/apps/dashboard/package.json              ./robot-os-chromium/apps/dashboard/
COPY robot-os-chromium/apps/signaling-server/package.json       ./robot-os-chromium/apps/signaling-server/
COPY robot-os-chromium/apps/sim-driver/package.json             ./robot-os-chromium/apps/sim-driver/
RUN cd robot-os-chromium && npm ci --omit=dev
COPY simulator/ ./simulator/
COPY robot-os-chromium/ ./robot-os-chromium/
WORKDIR /app/simulator
CMD ["node", "src/index.js"]
