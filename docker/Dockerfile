ARG MAILPIT_VERSION=1.28.0
ARG TRAEFIK_VERSION=3.7.5
#
# Mailpit binary
#
FROM golang:1.24-alpine3.20 AS mailpit-builder

ARG MAILPIT_VERSION
WORKDIR /app

ADD https://github.com/axllent/mailpit/archive/refs/tags/v${MAILPIT_VERSION}.tar.gz .

RUN apk add --no-cache git npm
RUN tar --strip-components=1 -zxf v${MAILPIT_VERSION}.tar.gz -C .
RUN npm install && npm run package
RUN CGO_ENABLED=0 go build -ldflags "-s -w -X github.com/axllent/mailpit/config.Version=${MAILPIT_VERSION}" -o /mailpit

#
# Runestone
#
FROM traefik:${TRAEFIK_VERSION} AS runestone

ARG MAILPIT_VERSION
ARG TARGETARCH
ARG USER=runestone
ARG UID=1000

ENV CAROOT=/ssl
ENV SOCKET_DIR=/tmp/${USER}_ssh-agent
ENV SSH_AUTH_SOCK=${SOCKET_DIR}/socket
ENV SSH_AUTH_PROXY_SOCK=${SOCKET_DIR}/proxy-socket
ENV MAILPIT_VERSION=${MAILPIT_VERSION}

ENV WEB_ENTRYPOINT_PORT=80 \
    WEB_ENTRYPOINT_NAME=web \
    WEB_SECURE_ENTRYPOINT_PORT=443 \
    WEB_SECURE_ENTRYPOINT_NAME=websecure

RUN wget -O /usr/local/bin/mkcert "https://dl.filippo.io/mkcert/latest?for=linux/${TARGETARCH}"

RUN apk --update --no-cache add bind-tools nginx openssh socat sudo tzdata envsubst && \
    adduser -D -u ${UID} ${USER} && \
    mkdir -p /configuration && chown ${USER} /configuration && \
    mkdir ${SOCKET_DIR} && chown ${USER} ${SOCKET_DIR} && \
    chmod +x /usr/local/bin/mkcert && \
    mkdir ${CAROOT} && \
    mkcert -install && \
    mkcert -cert-file ${CAROOT}/local.developers-homelab.net.crt -key-file ${CAROOT}/local.developers-homelab.net.key "*.local.developers-homelab.net" && \
    mkcert -cert-file ${CAROOT}/traefik.me.crt -key-file ${CAROOT}/traefik.me.key "*.traefik.me"

# Traefik general configuration
COPY traefik/traefik.tmp.yml /traefik.tmp.yml
COPY traefik/dynamic/traefik.dynamic.yml /default-configuration/traefik.dynamic.yml
COPY traefik/entrypoint.sh /entrypoint.sh


# Copy Mailpit binary
COPY --from=mailpit-builder /mailpit /usr/local/bin/

# Copy Catch-all configs
COPY catchall/nginx.conf /etc/nginx/http.d/default.conf
COPY catchall/index.tmp.html /usr/share/nginx/html/index.tmp.html

# Expose the SMTP and HTTP ports used by default by Mailpit:
EXPOSE 1025/tcp 8025/tcp

VOLUME ${SOCKET_DIR}
