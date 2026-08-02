import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
function getSecretKey() {
  const currentKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (currentKeys) {
    try {
      const parsed = JSON.parse(currentKeys);
      if (parsed.default) return parsed.default;
    } catch {
      // Continue with the legacy environment variable during key migration.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const supabase = createClient(supabaseUrl, getSecretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function corsHeaders(origin: string | null) {
  const allowed = isAllowedOrigin(origin) ? origin ?? "*" : "null";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "content-type, x-guaufresh-source",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function isAllowedOrigin(origin: string | null) {
  if (!origin) return true;
  if (/^https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/i.test(origin)) return true;
  if (/^https:\/\/(www\.)?guaufresh\.[a-z.]+$/i.test(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function response(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...corsHeaders(origin) },
  });
}

function text(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function email(value: unknown) {
  const normalized = text(value, 254).toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function phone(value: unknown) {
  return text(value, 24).replace(/\D/g, "").replace(/^57(?=3\d{9}$)/, "");
}

function isoDate(value: unknown, fallback: string) {
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

async function fingerprint(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const agent = req.headers.get("user-agent") || "unknown";
  const bytes = new TextEncoder().encode(`${ip}|${agent}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) return response({ error: "Origen no permitido" }, 403, origin);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") return response({ error: "Método no permitido" }, 405, origin);
  if (!isAllowedOrigin(origin)) return response({ error: "Origen no permitido" }, 403, origin);
  if (req.headers.get("x-guaufresh-source") !== "landing-feria") {
    return response({ error: "Fuente no válida" }, 403, origin);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 64_000) return response({ error: "Solicitud demasiado grande" }, 413, origin);

  const allowed = await supabase.rpc("allow_client_submission", {
    p_fingerprint: await fingerprint(req),
    p_limit: 12,
  });
  if (allowed.error) return response({ error: "No fue posible validar la solicitud" }, 503, origin);
  if (!allowed.data) return response({ error: "Demasiados intentos. Intenta más tarde." }, 429, origin);

  let record: Record<string, any>;
  try {
    record = await req.json();
  } catch {
    return response({ error: "JSON no válido" }, 400, origin);
  }

  const fullName = text(record?.contact?.fullName, 120);
  const normalizedPhone = phone(record?.contact?.phone);
  const normalizedEmail = email(record?.contact?.email);
  const consentPrivacy = record?.consent?.privacy === true;

  if (fullName.length < 2 || normalizedPhone.length < 10 || !consentPrivacy) {
    return response({ error: "Faltan datos obligatorios o autorización de privacidad" }, 422, origin);
  }

  const now = new Date().toISOString();
  const row = {
    local_id: text(record?.id, 100) || crypto.randomUUID(),
    full_name: fullName,
    phone: normalizedPhone,
    email: normalizedEmail,
    city: text(record?.contact?.city, 100) || null,
    neighborhood: text(record?.contact?.neighborhood, 120) || null,
    pet_name: text(record?.pet?.name, 100) || null,
    pet_species: text(record?.pet?.species, 40) || null,
    pet_breed: text(record?.pet?.breed, 100) || null,
    pet_size: text(record?.pet?.size, 40) || null,
    presentation: text(record?.commercial?.presentation, 40) || null,
    interest: text(record?.commercial?.interest, 80) || null,
    club: text(record?.commercial?.club, 120) || null,
    commercial_status: text(record?.commercial?.status, 40) || "nuevo",
    coupon: text(record?.commercial?.coupon, 60) || null,
    consent_marketing: record?.consent?.marketing === true,
    consent_privacy: consentPrivacy,
    consent_version: text(record?.consent?.version, 60) || null,
    consent_accepted_at: isoDate(record?.consent?.acceptedAt, now),
    attribution: typeof record?.attribution === "object" && record.attribution ? record.attribution : {},
    raw_record: record,
    first_seen_at: isoDate(record?.createdAt, now),
    last_interaction_at: isoDate(record?.lastInteractionAt, now),
    updated_at: now,
  };

  const saved = await supabase.rpc("upsert_guaufresh_client", { p_record: row });

  if (saved.error) return response({ error: "No fue posible guardar el registro" }, 500, origin);
  return response({ ok: true, customerId: saved.data }, 200, origin);
});
