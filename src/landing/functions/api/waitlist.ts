interface WaitlistEnv {
  WAITLIST?: D1Database;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const onRequestPost: PagesFunction<WaitlistEnv> = async (ctx) => {
  let body: { email?: string; website?: string };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ ok: false }, 400);
  }

  // Honeypot: bots fill the hidden "website" field; report success, store nothing.
  if (body.website) return json({ ok: true });

  const email = (body.email ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ ok: false }, 422);
  }

  const db = ctx.env.WAITLIST;
  if (!db) return json({ ok: false }, 503);

  await db.exec(
    "CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, created_at TEXT NOT NULL)"
  );
  await db
    .prepare("INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?1, ?2)")
    .bind(email, new Date().toISOString())
    .run();

  return json({ ok: true });
};
