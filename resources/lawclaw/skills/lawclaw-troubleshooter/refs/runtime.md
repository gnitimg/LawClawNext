# Native runtime

LawClaw Next runs the bundled DSH host directly on Windows. Do not recommend WSL as a prerequisite.

Check separately:

1. the bundled Node/DSH process started;
2. the authenticated HTTP/RPC proxy is reachable;
3. the WebSocket event stream is healthy;
4. renderer-to-main IPC is responding;
5. optional native Python tools are available only when their skill is invoked.

A running process is weaker evidence than an accepting authenticated endpoint.
