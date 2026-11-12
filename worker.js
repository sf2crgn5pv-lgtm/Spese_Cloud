
const COOKIE_NAME = "paolo_spese_session";
const SESSION_DAYS = 30;
const PASSWORD_ITERATIONS = 600000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin"
  };

  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function validOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;

  try {
    const url = new URL(origin);
    return (
      url.hostname.endsWith(".pages.dev") ||
      url.hostname.endsWith(".workers.dev") ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

function randomToken(length = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64(new Uint8Array(digest));
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    key,
    256
  );

  return bytesToBase64(new Uint8Array(bits));
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;

  let result = 0;
  for (let i = 0; i < x.length; i++) result |= x[i] ^ y[i];
  return result === 0;
}

function cookie(token, maxAge) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function getCookie(request) {
  const value = request.headers.get("Cookie") || "";
  const match = value.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function getSession(request, env) {
  const token = getCookie(request);
  if (!token) return null;

  const tokenHash = await sha256(token);
  const now = Date.now();

  const result = await env.DB.prepare(`
    SELECT s.id, s.user_id, s.device_id, s.expires_at,
           u.email
    FROM app_session s
    JOIN app_user u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
    LIMIT 1
  `).bind(tokenHash, now).first();

  if (result && result.device_id) {
    await env.DB.prepare(`
      UPDATE sync_devices
      SET last_seen_at = ?
      WHERE device_id = ? AND revoked_at IS NULL
    `).bind(now, result.device_id).run();
  }

  return result;
}

async function register(request, env) {
  const data = await body(request);

  if (!data || typeof data.email !== "string" ||
      typeof data.password !== "string") {
    return json({ ok: false, error: "Dati non validi" }, 400);
  }

  if (
    !env.BOOTSTRAP_SECRET ||
    typeof data.setup_key !== "string" ||
    !safeEqual(data.setup_key, env.BOOTSTRAP_SECRET)
  ) {
    return json({
      ok: false,
      error: "Codice di configurazione non valido"
    }, 403);
  }

  const email = data.email.trim().toLowerCase();
  const password = data.password;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Email non valida" }, 400);
  }

  if (password.length < 12 || password.length > 256) {
    return json({
      ok: false,
      error: "La password deve contenere almeno 12 caratteri"
    }, 400);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derivePassword(
    password,
    salt,
    PASSWORD_ITERATIONS
  );

  const now = Date.now();

  const result = await env.DB.prepare(`
    INSERT INTO app_user
      (email, password_hash, password_salt,
       password_iterations, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM app_user)
  `).bind(
    email,
    passwordHash,
    bytesToBase64(salt),
    PASSWORD_ITERATIONS,
    now,
    now
  ).run();

  if (!result.meta.changes) {
    return json({
      ok: false,
      error: "Registrazione non disponibile"
    }, 409);
  }

  return json({
    ok: true,
    message: "Utente registrato"
  }, 201);
}

async function login(request, env) {
  const data = await body(request);

  if (!data || typeof data.email !== "string" ||
      typeof data.password !== "string") {
    return json({ ok: false, error: "Dati non validi" }, 400);
  }

  const email = data.email.trim().toLowerCase();

  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, password_salt,
           password_iterations
    FROM app_user
    WHERE email = ?
    LIMIT 1
  `).bind(email).first();

  if (!user) {
    return json({ ok: false, error: "Credenziali non valide" }, 401);
  }

  const calculated = await derivePassword(
    data.password,
    base64ToBytes(user.password_salt),
    user.password_iterations
  );

  if (!safeEqual(calculated, user.password_hash)) {
    return json({ ok: false, error: "Credenziali non valide" }, 401);
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const deviceId = typeof data.device_id === "string" &&
    data.device_id.length <= 128
      ? data.device_id
      : randomToken(16);

  const deviceName = typeof data.device_name === "string"
    ? data.device_name.slice(0, 100)
    : "Dispositivo";

  const now = Date.now();
  const expires = now + SESSION_DAYS * 24 * 60 * 60 * 1000;

  await env.DB.prepare(`
    INSERT INTO sync_devices
      (device_id, device_name, created_at, last_seen_at, revoked_at)
    VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(device_id) DO UPDATE SET
      device_name = excluded.device_name,
      last_seen_at = excluded.last_seen_at,
      revoked_at = NULL
  `).bind(deviceId, deviceName, now, now).run();

  await env.DB.prepare(`
    INSERT INTO app_session
      (user_id, token_hash, device_id, created_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).bind(user.id, tokenHash, deviceId, now, expires).run();

  return json({
    ok: true,
    user: { id: user.id, email: user.email },
    device_id: deviceId,
    expires_at: expires
  }, 200, {
    "Set-Cookie": cookie(token, SESSION_DAYS * 86400)
  });
}

async function logout(request, env) {
  const token = getCookie(request);

  if (token) {
    const tokenHash = await sha256(token);
    await env.DB.prepare(`
      UPDATE app_session
      SET revoked_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL
    `).bind(Date.now(), tokenHash).run();
  }

  return json({ ok: true }, 200, {
    "Set-Cookie": cookie("", 0)
  });
}

async function me(session) {
  return json({
    ok: true,
    user: {
      id: session.user_id,
      email: session.email
    },
    device_id: session.device_id,
    expires_at: session.expires_at
  });
}

async function pull(request, env) {
  const url = new URL(request.url);
  const since = Math.max(0, Number(url.searchParams.get("since")) || 0);

  const [movements, accounts, budgets] = await Promise.all([
    env.DB.prepare(`
      SELECT sync_id, local_id, payload_json, revision,
             updated_at, deleted_at, device_id
      FROM cloud_movements
      WHERE updated_at > ?
      ORDER BY updated_at
    `).bind(since).all(),

    env.DB.prepare(`
      SELECT sync_id, legacy_id, payload_json, revision,
             updated_at, deleted_at, device_id
      FROM cloud_accounts
      WHERE updated_at > ?
      ORDER BY updated_at
    `).bind(since).all(),

    env.DB.prepare(`
      SELECT category, amount, updated_at
      FROM cloud_budgets
      WHERE updated_at > ?
      ORDER BY updated_at
    `).bind(since).all()
  ]);

  return json({
    ok: true,
    server_time: Date.now(),
    movements: movements.results,
    accounts: accounts.results,
    budgets: budgets.results
  });
}

async function push(request, env, session) {
  const data = await body(request);

  if (!data || !Array.isArray(data.movements) ||
      !Array.isArray(data.accounts) ||
      !Array.isArray(data.budgets)) {
    return json({ ok: false, error: "Formato sincronizzazione non valido" }, 400);
  }

  if (data.movements.length > 500 ||
      data.accounts.length > 100 ||
      data.budgets.length > 100) {
    return json({ ok: false, error: "Numero di elementi eccessivo" }, 413);
  }

  const deviceId = session.device_id;
  const now = Date.now();
  const conflicts = [];
  let saved = 0;

  for (const item of data.movements) {
    if (!item.sync_id || typeof item.sync_id !== "string" ||
        item.sync_id.length > 128 || !item.payload) continue;

    const baseRevision = Math.max(0, Number(item.base_revision) || 0);
    const payload = typeof item.payload === "string"
      ? item.payload
      : JSON.stringify(item.payload);

    const result = await env.DB.prepare(`
      INSERT INTO cloud_movements
        (sync_id, local_id, payload_json, revision,
         updated_at, deleted_at, device_id)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(sync_id) DO UPDATE SET
        local_id = excluded.local_id,
        payload_json = excluded.payload_json,
        revision = cloud_movements.revision + 1,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id
      WHERE cloud_movements.revision = ?
    `).bind(
      item.sync_id,
      Number.isInteger(item.local_id) ? item.local_id : null,
      payload,
      now,
      item.deleted ? now : null,
      deviceId,
      baseRevision
    ).run();

    if (result.meta.changes) saved++;
    else conflicts.push({ type: "movement", sync_id: item.sync_id });
  }

  for (const item of data.accounts) {
    if (!item.sync_id || typeof item.sync_id !== "string" ||
        item.sync_id.length > 128 || !item.payload) continue;

    const baseRevision = Math.max(0, Number(item.base_revision) || 0);
    const payload = typeof item.payload === "string"
      ? item.payload
      : JSON.stringify(item.payload);

    const result = await env.DB.prepare(`
      INSERT INTO cloud_accounts
        (sync_id, legacy_id, payload_json, revision,
         updated_at, deleted_at, device_id)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(sync_id) DO UPDATE SET
        legacy_id = excluded.legacy_id,
        payload_json = excluded.payload_json,
        revision = cloud_accounts.revision + 1,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id
      WHERE cloud_accounts.revision = ?
    `).bind(
      item.sync_id,
      item.legacy_id == null ? null : String(item.legacy_id),
      payload,
      now,
      item.deleted ? now : null,
      deviceId,
      baseRevision
    ).run();

    if (result.meta.changes) saved++;
    else conflicts.push({ type: "account", sync_id: item.sync_id });
  }

  for (const item of data.budgets) {
    if (typeof item.category !== "string" ||
        !item.category.trim() ||
        !Number.isFinite(Number(item.amount))) continue;

    await env.DB.prepare(`
      INSERT INTO cloud_budgets (category, amount, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET
        amount = excluded.amount,
        updated_at = excluded.updated_at
    `).bind(item.category.trim(), Number(item.amount), now).run();

    saved++;
  }

  return json({
    ok: true,
    saved,
    conflicts,
    server_time: now
  });
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (!validOrigin(request)) {
      return json({ ok: false, error: "Origine non autorizzata" }, 403, headers);
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (request.method === "GET" && path === "/health") {
        return json({ ok: true, service: "paolo-spese-api" }, 200, headers);
      }

      if (request.method === "POST" && path === "/auth/register") {
        const response = await register(request, env);
        return addHeaders(response, headers);
      }

      if (request.method === "POST" && path === "/auth/login") {
        const response = await login(request, env);
        return addHeaders(response, headers);
      }

      if (request.method === "POST" && path === "/auth/logout") {
        const response = await logout(request, env);
        return addHeaders(response, headers);
      }

      const session = await getSession(request, env);

      if (!session) {
        return json({ ok: false, error: "Autenticazione richiesta" }, 401, headers);
      }

      if (request.method === "GET" && path === "/auth/me") {
        return addHeaders(await me(session), headers);
      }

      if (request.method === "GET" && path === "/sync/pull") {
        return addHeaders(await pull(request, env), headers);
      }

      if (request.method === "POST" && path === "/sync/push") {
        return addHeaders(await push(request, env, session), headers);
      }

      return json({ ok: false, error: "Endpoint non trovato" }, 404, headers);

    } catch (error) {
      return json({
        ok: false,
        error: "Errore interno del servizio"
      }, 500, headers);
    }
  }
};

function addHeaders(response, extraHeaders) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
