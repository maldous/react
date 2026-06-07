import { http, HttpResponse } from "msw";

export const handlers = [http.get("/healthz", () => HttpResponse.json({ status: "ok" }))];
