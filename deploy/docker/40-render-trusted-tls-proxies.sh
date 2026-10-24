#!/bin/sh
# The official nginx entrypoint invokes this with no arguments. A destination
# override is available only as an explicit unit-test argument, never an env var.
set -eu
set -f
umask 022

output=/etc/nginx/web-trusted-tls-proxies.conf
test_only=0
if [ "$#" -ne 0 ]; then
    if [ "$#" -ne 2 ] || [ "$1" != "--test-output" ]; then
        printf '%s\n' 'Usage: 40-render-trusted-tls-proxies.sh [--test-output PATH]' >&2
        exit 1
    fi
    output=$2
    test_only=1
fi

fail() {
    printf '%s\n' "Invalid DSC_TRUSTED_TLS_PROXY_CIDRS: $1" >&2
    exit 1
}

# Whitespace-separated IPs/CIDRs only. Explicit IFS plus noglob prevents tokens
# such as '*' from expanding to a legitimate-looking local filename.
IFS='
 	'
entries=''
count=0
for token in ${DSC_TRUSTED_TLS_PROXY_CIDRS:-}; do
    count=$((count + 1))
    [ "$count" -le 128 ] || fail 'at most 128 entries are allowed'
    case "$token" in
        *[!0-9a-fA-F.:/]*) fail 'only IP/CIDR characters are allowed' ;;
    esac
    case "$token" in
        */*)
            address=${token%/*}
            prefix=${token##*/}
            case "$address" in
                ''|*/*) fail 'invalid network address' ;;
            esac
            case "$prefix" in
                ''|*[!0-9]*) fail 'invalid prefix length' ;;
            esac
            # Also reject /00, /000, etc., without numeric overflow or octal
            # parsing. nginx -t checks address syntax and remaining mask bounds.
            case "$prefix" in
                *[1-9]*) ;;
                *) fail 'default routes are not allowed' ;;
            esac
            ;;
    esac
    entries="$entries$token 1;
"
done

# Validate the entire input before touching the configuration. Invalid input
# aborts startup, rather than starting nginx with a partially trusted network.
printf '%s' "$entries" > "$output"
if [ "$test_only" -eq 0 ]; then
    # geo parses IPs/CIDRs here. 'resolve' in the fixed upstream defers DNS, so
    # checking syntax does not require the server container to be running.
    nginx -t
fi
