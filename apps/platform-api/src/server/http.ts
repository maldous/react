import http from "node:http";
import process from "node:process";
import { createRouter } from "./pipeline.ts";
import { routes } from "./routes.ts";

const PORT = Number(process.env["PLATFORM_API_PORT"] ?? 3001);
const router = createRouter(routes);
const server = http.createServer(router);

server.listen(PORT, () => {
  process.stdout.write(`platform-api listening on http://localhost:${PORT}\n`);
});
