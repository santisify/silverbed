/**
 * Vercel entry point.
 *
 * The platform's Node runtime accepts a web-standard `fetch` handler and
 * bundles the imported TypeScript itself, so no separate build step is needed
 * for the API — `bun run build` only has to produce `web/dist`.
 */
export { default } from "../server/src/vercel";
