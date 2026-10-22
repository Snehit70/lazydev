// A stand-in dev server for proxy tests. Behaves like Vite's HMR endpoint in
// that it only accepts WebSocket upgrades that ask for the "vite-hmr" protocol.
const port = Number(process.env["PORT"] ?? 0);
const hostname = process.env["HOST"] ?? "127.0.0.1";

interface SocketData {
  cookie: string | null;
}

const server: ReturnType<typeof Bun.serve<SocketData>> = Bun.serve<SocketData>({
  port,
  hostname,
  async fetch(req, srv): Promise<Response | undefined> {
    const url = new URL(req.url);

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      if (req.headers.get("sec-websocket-protocol") !== "vite-hmr") {
        return new Response("missing vite-hmr protocol", { status: 400 });
      }
      return srv.upgrade(req, { data: { cookie: req.headers.get("cookie") } }) ? undefined : new Response("upgrade failed", { status: 500 });
    }

    switch (url.pathname) {
      case "/gzip":
        return new Response(Bun.gzipSync(new TextEncoder().encode("compressed ".repeat(100))), {
          headers: { "content-encoding": "gzip", "content-type": "text/plain" },
        });
      case "/redirect":
        return new Response(null, { status: 302, headers: { location: `http://localhost:${server.port}/target?x=1` } });
      case "/cookies": {
        const headers = new Headers();
        headers.append("set-cookie", "a=1; Path=/");
        headers.append("set-cookie", "b=2; Path=/");
        return new Response("ok", { headers });
      }
      case "/body":
        return new Response(await req.text());
      case "/sse": {
        // One event now, the next much later: a buffering proxy would hold the first.
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("data: first\n\n"));
            await Bun.sleep(3000);
            controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }
      default:
        return Response.json({
          port: server.port,
          path: url.pathname + url.search,
          host: req.headers.get("host"),
          forwardedHost: req.headers.get("x-forwarded-host"),
          forwardedProto: req.headers.get("x-forwarded-proto"),
          forwardedFor: req.headers.get("x-forwarded-for"),
        });
    }
  },
  websocket: {
    open(ws) {
      ws.send(`hello cookie=${ws.data.cookie}`);
    },
    message(ws, message) {
      ws.send(`echo:${message}`);
    },
  },
});

console.log(`ready ${server.port}`);
