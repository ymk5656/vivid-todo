FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG AUDIVERIS_VERSION=5.10.2

RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
        python3 \
        python3-pip \
        wget \
        libglib2.0-0 \
        libx11-6 \
        libxext6 \
        libxrender1 \
        libxtst6 \
        libxi6 \
    && rm -rf /var/lib/apt/lists/*

# Extract deb contents without running post-install scripts
# (post-install tries to register desktop icons which fails headless)
RUN wget -q \
        "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu22.04-x86_64.deb" \
        -O /tmp/audiveris.deb \
    && dpkg-deb -x /tmp/audiveris.deb / \
    && rm /tmp/audiveris.deb

# Show where Audiveris was installed (visible in docker build output)
RUN find /opt -maxdepth 3 -name "audiveris" -o -name "Audiveris" 2>/dev/null | head -10 || true

ENV PATH="/opt/audiveris/bin:/opt/Audiveris/bin:$PATH"
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt
COPY server.py .

# Railway injects $PORT at runtime and only routes traffic to that port.
# Use shell form so ${PORT} expands; fall back to 8000 for local/docker-compose.
EXPOSE 8000
CMD python3 -m uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}
