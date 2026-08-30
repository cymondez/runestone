ARG ALPINE_VERSION=3.22
ARG WEBPROC_VERSION=0.4.0

#
# runestone-dns
#
# dnsmasq answering Runestone domains, supervised by webproc so that the user's
# own rules can be edited through a web UI without exposing the two files
# Runestone owns. See docs/DNS-FEATURE-SPEC.md sections 8.1 to 8.3.
#
FROM alpine:${ALPINE_VERSION} AS runestone-dns

ARG WEBPROC_VERSION
ARG TARGETARCH

# From webproc_0.4.0_checksums.txt. A downloaded binary that nothing verifies is
# a supply-chain hole, and this one ends up answering DNS for every container on
# the machine.
ARG WEBPROC_SHA256_amd64=6f805a07aa975d99ff06c7ea3097fa155d5aada1931e947b15a68170b2b00eb0
ARG WEBPROC_SHA256_arm64=3dcd0b7bd57fa25a452c2a049d02d92968c5c5ac0c389978a2f0a66907dad5c1

ENV WEBPROC_VERSION=${WEBPROC_VERSION} \
    DNS_UI_PORT=8080 \
    SSL_DIR=/ssl

RUN apk add --no-cache dnsmasq ca-certificates openssl

# webproc publishes linux_amd64 and linux_arm64 release assets, and TARGETARCH
# uses exactly those two names, so no architecture mapping table is needed.
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) expected="${WEBPROC_SHA256_amd64}" ;; \
      arm64) expected="${WEBPROC_SHA256_arm64}" ;; \
      *) echo "runestone-dns: unsupported TARGETARCH '${TARGETARCH}'" >&2; exit 1 ;; \
    esac; \
    asset="webproc_${WEBPROC_VERSION}_linux_${TARGETARCH}.gz"; \
    wget -q -O "/tmp/${asset}" \
      "https://github.com/jpillora/webproc/releases/download/v${WEBPROC_VERSION}/${asset}"; \
    echo "${expected}  /tmp/${asset}" | sha256sum -c -; \
    gunzip -c "/tmp/${asset}" > /usr/local/bin/webproc; \
    rm -f "/tmp/${asset}"; \
    chmod +x /usr/local/bin/webproc

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 53 is dnsmasq. 8080 is webproc's UI, which the Compose service deliberately
# does not publish to the host (spec 8.2).
EXPOSE 53/tcp 53/udp 8080/tcp

ENTRYPOINT ["/entrypoint.sh"]
