const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Standard envelope response. The HTTP status now matches the business code
 * (400/401/403/404/409/429/500) so proxies, CDNs and logs see real statuses;
 * the body keeps the `{ code, message, data }` shape for client compatibility.
 */
export function jsonResponse(
  data: unknown,
  code = 200,
  message = "success"
): Response {
  const status = code >= 200 && code <= 599 ? code : 500;
  return Response.json(
    { code, message, data },
    { status, headers: corsHeaders }
  );
}

/** 204 response for CORS preflight. */
export function corsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
