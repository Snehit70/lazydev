# LazyDev

This context defines the routing language for the proxy-only development server helper.

## Language

**Proxy Route**:
The clean local hostname that forwards traffic to a running dev server.
_Avoid_: URL, endpoint

**Discovered Port**:
The locally detected port where a target dev server is already listening.
_Avoid_: assigned port, target port

**Project Alias**:
A short name mapped to a project path or to a port, for faster local access or to pin a route to one port.
_Avoid_: nickname, shortcut

**Projects Root**:
A directory whose subdirectories are projects. There can be several; a project name in an earlier root shadows the same name in a later one.
_Avoid_: workspace, base dir

**Hidden Process**:
A process owned by the user whose cwd and sockets LazyDev cannot read, typically because it was started from a binary with file capabilities. Its ports cannot become Discovered Ports.
_Avoid_: invisible server, zombie

**Proxy Daemon**:
The background process that handles hostname routing.
_Avoid_: service, worker
