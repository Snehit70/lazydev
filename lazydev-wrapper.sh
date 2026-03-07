#!/bin/bash
# LazyDev systemd wrapper - runs as user
cd /home/snehit
exec /home/snehit/.bun/bin/bun run /home/snehit/projects/lazydev/src/index.ts run
