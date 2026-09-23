#!/bin/sh
# A stand-in for Chrome, for tests/capture-chrome.test.ts. It does the one
# part of Chrome's start-up that tools/capture/cdp.ts depends on: writes
# DevToolsActivePort into the --user-data-dir it was given, naming the port
# of the test's fake DevTools server, then waits to be stopped.
#
# The test copies this script into a temp folder and puts two things beside
# it: `port`, holding the fake server's port (read from a file because
# Bun.spawn does not pass on environment variables set at run time), and,
# for a Chrome that cannot start, `die`, which makes it exit 3 at once.
here="$(dirname "$0")"
if [ -e "$here/die" ]; then exit 3; fi
for a in "$@"; do
  case "$a" in --user-data-dir=*) profile="${a#--user-data-dir=}";; esac
done
printf '%s\n/devtools/browser/fake\n' "$(cat "$here/port")" > "$profile/DevToolsActivePort"
exec sleep 60
