const ALLOWED_COUNTRIES = new Set(["BG"]);

export const onRequest: PagesFunction = async (ctx) => {
  const country =
    (ctx.request as Request & { cf?: { country?: string } }).cf?.country ??
    ctx.request.headers.get("cf-ipcountry") ??
    "";

  if (!ALLOWED_COUNTRIES.has(country)) {
    return new Response(
      "Uniffy is currently available only in Bulgaria.",
      {
        status: 403,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }

  return ctx.next();
};
