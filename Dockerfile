FROM node:20-slim

# ffmpeg, yt-dlp, 오디오 코덱, 빌드 도구 설치
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    libopus0 \
    libopus-dev \
    libsodium23 \
    libsodium-dev \
    build-essential \
    curl \
    && pip3 install --break-system-packages yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp 설치 확인
RUN yt-dlp --version

WORKDIR /app

# package.json 복사 및 의존성 설치
COPY package*.json ./
RUN npm install --omit=dev

# 소스 코드 복사
COPY . .

CMD ["npm", "start"]
