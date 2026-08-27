#!/bin/sh
set -e

if [ "$1" = "ssh-add" ]; then

    exec "$@"

else

transform_templates_to_configs(){
    # transform error page template to actual error page with env vars substituted
    envsubst "$(env | awk -F= '{printf "$%s ", $1}')" < /usr/share/nginx/html/index.tmp.html > /usr/share/nginx/html/index.html

    envsubst "$(env | awk -F= '{printf "$%s ", $1}')" < /traefik.tmp.yml > /traefik.yml
}

copy_default_configs_if_missing(){
    # Copy default configs if they don't exist (allows for user overrides)
    [ -f /configuration/traefik.dynamic.yml ] || cp /default-configuration/traefik.dynamic.yml /configuration/traefik.dynamic.yml
}

create_ssh_proxy(){
    # Clean up previous socket files
    sudo -u druid rm -f "${SSH_AUTH_SOCK}" "${SSH_AUTH_PROXY_SOCK}"

    # Create proxy-socket for ssh-agent (to give anyone access to the ssh-agent socket)
    echo "Creating proxy socket..."
    sudo -u druid socat UNIX-LISTEN:"${SSH_AUTH_PROXY_SOCK}",perm=0666,fork UNIX-CONNECT:"${SSH_AUTH_SOCK}" &

    # Start ssh-agent
    echo "Launching ssh-agent..."
    sudo -u druid /usr/bin/ssh-agent -a "${SSH_AUTH_SOCK}" -d
}

start_nginx(){
    echo "Start up Nginx..."
    exec nginx -g 'daemon off;'
}

start_mailpit(){
    echo "Start up Mailpit ${MAILPIT_VERSION}..."
    exec mailpit --verbose
}

transform_templates_to_configs
copy_default_configs_if_missing
create_ssh_proxy &
start_nginx &
start_mailpit &

# first arg is `-f` or `--some-option`
if [ "${1#-}" != "$1" ]; then
    set -- traefik "$@"
fi

# if our command is a valid Traefik subcommand, let's invoke it through Traefik instead
# (this allows for "docker run traefik version", etc)
if traefik "$1" --help >/dev/null 2>&1
then
    set -- traefik "$@"
else
    echo "= '$1' is not a Traefik command: assuming shell execution." 1>&2
fi

exec "$@"

fi
