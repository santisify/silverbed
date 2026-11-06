import { createApp, type AppInstance } from "./app";

/**
 * Serverless entry: a web-standard `fetch` handler, which Vercel's Node runtime
 * (and any Fetch-compatible host) can call directly. The app is created once
 * per instance, so a warm function keeps its database pool.
 */
let pending: Promise<AppInstance> | null = null;

export default {
  async fetch(request: Request): Promise<Response> {
    pending ??= createApp();
    const app = await pending;
    return app.handle(request);
  },
};
