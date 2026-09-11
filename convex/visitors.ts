import { httpAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const ALLOWED_ORIGINS = new Set([
  "https://iam-phasma.github.io",
  "https://iskawt.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours per IP

function isAllowedOrigin(origin: string) {
  if (ALLOWED_ORIGINS.has(origin)) return true;

  // Allow Vercel domains (production and preview), plus localhost ports.
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  if (/^https?:\/\/localhost(?::\d+)?$/i.test(origin)) return true;
  if (/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin)) return true;

  return false;
}

function buildCorsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export const trackVisitOptions = httpAction(async (_ctx, request) => {
  const origin = request.headers.get("Origin") ?? "";
  if (!isAllowedOrigin(origin)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
});

export const trackVisit = httpAction(async (ctx, request) => {
  const origin = request.headers.get("Origin") ?? "";
  if (!isAllowedOrigin(origin)) {
    return new Response(null, { status: 403 });
  }

  // Extract the real client IP (Convex passes it via x-forwarded-for)
  const ip =
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown";

  const count = await ctx.runMutation(internal.visitors.increment, { ip });

  return new Response(count !== null ? JSON.stringify({ count }) : null, {
    status: count !== null ? 200 : 200,
    headers: {
      "Content-Type": "application/json",
      ...buildCorsHeaders(origin),
    },
  });
});

export const increment = internalMutation({
  args: { ip: v.string() },
  handler: async ({ db }, { ip }) => {
    const now = Date.now();

    // Rate-limit: one count per IP per 24 hours
    const existing = await db
      .query("visitorIps")
      .withIndex("by_ip", (q) => q.eq("ip", ip))
      .first();

    if (existing !== null && now - existing.lastVisit < COOLDOWN_MS) {
      // Already counted this IP recently — return current count without incrementing
      const row = await db.query("visitors").first();
      return row?.count ?? 0;
    }

    // Upsert the IP record
    if (existing === null) {
      await db.insert("visitorIps", { ip, lastVisit: now });
    } else {
      await db.patch(existing._id, { lastVisit: now });
    }

    // Increment the global counter
    const row = await db.query("visitors").first();
    if (row === null) {
      await db.insert("visitors", { count: 1 });
      return 1;
    }
    const newCount = row.count + 1;
    await db.patch(row._id, { count: newCount });
    return newCount;
  },
});
