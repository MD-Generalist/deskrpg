# DeskRPG Office — 사무실(DeskRPG)과 두뇌(Hermes Agent)를 한 컨테이너에 담는다.
#
# DeskRPG 는 Hermes 없이는 아무 일도 하지 못한다. 둘을 따로 배포하면 사용자는 주소·키·버전을
# 손으로 맞춰야 하고, 그 자리에서 대부분 막힌다. 그래서 공식 Hermes 이미지를 바탕에 깔고
# DeskRPG 를 얹어, 게이트웨이·대시보드·사무실이 같은 수명주기로 뜨고 지게 만든다.
#
# 공식 이미지에 이미 있는 것을 다시 만들지 않는다: s6 감독 트리, dashboard 서비스,
# Node 26, HERMES_HOME(/opt/data) 볼륨. 우리는 서비스 하나(deskrpg)와 초기화 훅 하나를 더한다.
#
# amd64 로 빌드할 것. 공식 latest 의 arm64 변종은 2026-06 버전(0.21.1 미만)이라 플러그인이
# 로드되지 않는다(실측). VPS 는 amd64 이므로 문제되지 않지만, Apple Silicon 에서 그냥 빌드하면
# 낡은 바탕을 깔게 된다.
FROM --platform=linux/amd64 nousresearch/hermes-agent:latest

LABEL org.opencontainers.image.title="DeskRPG Office" \
      org.opencontainers.image.description="DeskRPG + Hermes Agent in one container (gateway, dashboard, virtual office)" \
      org.opencontainers.image.source="https://github.com/dandacompany/deskrpg" \
      org.opencontainers.image.licenses="MIT"

# 빌드 시점의 최신 DeskRPG. 컨테이너가 뜰 때 다시 최신으로 올릴지는 DESKRPG_AUTO_UPDATE 가 정한다.
# 방금 발행한 버전으로 구우면 dist-tag 가 먼저 보이고 tarball 이 CDN 에 늦게 올라와 404 가
# 난다(실측: 2026.9.21 직후 빌드). 잠깐 기다렸다 다시 시도한다.
RUN for attempt in 1 2 3 4 5; do \
      npm install -g deskrpg@latest && break; \
      echo "npm install 실패 ($attempt/5) — 30초 뒤 다시 시도"; \
      sleep 30; \
    done; \
    npm ls -g deskrpg >/dev/null \
 && npm cache clean --force

# 사무실 서비스와 초기화 훅
COPY s6-rc.d/deskrpg /etc/s6-overlay/s6-rc.d/deskrpg
COPY s6-rc.d/hermes-gateway /etc/s6-overlay/s6-rc.d/hermes-gateway
COPY scripts/start-gateway /opt/deskrpg/start-gateway
COPY cont-init.d/03-deskrpg-setup /etc/cont-init.d/03-deskrpg-setup
RUN chmod +x /etc/s6-overlay/s6-rc.d/deskrpg/run /etc/s6-overlay/s6-rc.d/deskrpg/finish \
      /opt/deskrpg/start-gateway /etc/cont-init.d/03-deskrpg-setup \
 && touch /etc/s6-overlay/s6-rc.d/user/contents.d/deskrpg \
 && touch /etc/s6-overlay/s6-rc.d/user/contents.d/hermes-gateway

# 3000 사무실(HTTP) · 3001 소켓 · 8642 Hermes API · 9119 대시보드
EXPOSE 3000 3001 9119

ENV DESKRPG_HOME=/opt/data/deskrpg \
    DESKRPG_AUTO_UPDATE=true \
    HERMES_DASHBOARD=true \
    INTERNAL_HOSTNAME=0.0.0.0 \
    HOSTNAME=0.0.0.0

# 컨테이너의 main program 은 Hermes TUI(`hermes`)다. TTY 가 없으면 곧바로 끝나고, s6 는 main
# 이 끝나면 컨테이너 전체를 내린다 — 사무실도 게이트웨이도 같이 죽는다(실측: Exited (0)).
# TUI 는 `docker exec -it <컨테이너> hermes` 로 들어가는 것이 이 이미지의 사용법이므로,
# main 은 잠들어 있게 두고 s6 가 서비스들을 감독하게 한다. main-wrapper 는 첫 인자가 실행
# 파일이면 그대로 exec 한다.
CMD ["sleep", "infinity"]
