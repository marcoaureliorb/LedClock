
FROM python:3.12-slim

WORKDIR /workspace

RUN pip install --no-cache-dir platformio

COPY platformio.ini .

RUN pio pkg install

COPY . .

CMD ["pio", "run"]