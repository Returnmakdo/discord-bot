FROM node:20-slim

# ffmpeg 및 오디오 코덱, 빌드 도구 설치
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libopus0 \
    libopus-dev \
    libsodium23 \
    libsodium-dev \
    python3 \
    build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# package.json 복사 및 의존성 설치
COPY package*.json ./
RUN npm install --omit=dev

# 소스 코드 복사
COPY . .

CMD ["npm", "start"]
