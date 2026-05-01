import { createHash, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, "data");
const recordingsDir = path.join(dataDir, "recordings");
const usersFile = path.join(dataDir, "users.json");
const recordingsFile = path.join(dataDir, "recordings.json");
const sessionsFile = path.join(dataDir, "sessions.json");
const captchaFile = path.join(dataDir, "captcha.json");
const passwordResetsFile = path.join(dataDir, "password-resets.json");
const port = Number(process.env.PORT || 4173);
const maxUploadBytes = 50 * 1024 * 1024;
const termsVersion = "2026-05-02";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav"
};

await ensureStorage();

const server = http.createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong." });
  }
});

server.listen(port, () => {
  console.log(`Breakthrough Financial Wellness running at http://localhost:${port}`);
});

async function ensureStorage() {
  await fs.mkdir(recordingsDir, { recursive: true });
  await ensureJson(usersFile, []);
  await ensureJson(recordingsFile, []);
  await ensureJson(sessionsFile, []);
  await ensureJson(captchaFile, []);
  await ensureJson(passwordResetsFile, []);
}

async function ensureJson(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2));
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/captcha") {
    await createCaptcha(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, name: "Breakthrough Financial Wellness" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/signup") {
    await signup(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    await login(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    await logout(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/forgot-password") {
    await forgotPassword(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/reset-password") {
    await resetPassword(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const session = await getSession(req);
    if (!session) {
      sendJson(res, 200, { user: null });
      return;
    }
    sendJson(res, 200, { user: publicUser(session.user) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/recordings") {
    const session = await requireSession(req, res);
    if (!session) return;
    const recordings = await readJson(recordingsFile, []);
    const ownRecordings = recordings
      .filter((recording) => recording.userId === session.user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ id, title, createdAt, size, mimeType, duration }) => ({
        id,
        title,
        createdAt,
        size,
        mimeType,
        duration,
        url: `/api/recordings/${id}/audio`
      }));
    sendJson(res, 200, { recordings: ownRecordings });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/recordings") {
    const session = await requireSession(req, res);
    if (!session) return;
    await saveRecording(req, res, session.user);
    return;
  }

  const audioMatch = url.pathname.match(/^\/api\/recordings\/([a-f0-9]+)\/audio$/);
  if (req.method === "GET" && audioMatch) {
    const session = await requireSession(req, res);
    if (!session) return;
    await streamRecording(req, res, session.user, audioMatch[1]);
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/recordings\/([a-f0-9]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    const session = await requireSession(req, res);
    if (!session) return;
    await deleteRecording(req, res, session.user, deleteMatch[1]);
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

async function signup(req, res) {
  const { name, email, password, termsAccepted, captchaId, captchaAnswer } = await readJsonBody(req);
  const cleanName = String(name || "").trim();
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || "");

  if (!cleanName || !cleanEmail || cleanPassword.length < 8) {
    sendJson(res, 400, { error: "Use a name, valid email, and password of at least 8 characters." });
    return;
  }

  if (!termsAccepted) {
    sendJson(res, 400, { error: "Please agree to the terms and conditions to create an account." });
    return;
  }

  if (!(await requireCaptcha(captchaId, captchaAnswer, res))) return;

  const users = await readJson(usersFile, []);
  if (users.some((user) => user.email === cleanEmail)) {
    sendJson(res, 409, { error: "An account already exists for that email." });
    return;
  }

  const user = {
    id: randomId(),
    name: cleanName,
    email: cleanEmail,
    passwordHash: await hashPassword(cleanPassword),
    termsAcceptedAt: new Date().toISOString(),
    termsVersion,
    createdAt: new Date().toISOString()
  };

  users.push(user);
  await writeJson(usersFile, users);
  await createSession(res, user);
  sendJson(res, 201, { user: publicUser(user) });
}

async function login(req, res) {
  const { email, password, captchaId, captchaAnswer } = await readJsonBody(req);
  if (!(await requireCaptcha(captchaId, captchaAnswer, res))) return;

  const users = await readJson(usersFile, []);
  const user = users.find((entry) => entry.email === normalizeEmail(email));

  if (!user || !(await verifyPassword(String(password || ""), user.passwordHash))) {
    sendJson(res, 401, { error: "The email or password did not match." });
    return;
  }

  await createSession(res, user);
  sendJson(res, 200, { user: publicUser(user) });
}

async function forgotPassword(req, res) {
  const { email, captchaId, captchaAnswer } = await readJsonBody(req);
  if (!(await requireCaptcha(captchaId, captchaAnswer, res))) return;

  const cleanEmail = normalizeEmail(email);
  const users = await readJson(usersFile, []);
  const user = users.find((entry) => entry.email === cleanEmail);
  const response = {
    message: "If that email exists, a reset code has been created."
  };

  if (user) {
    const resetCode = String(randomInt(100000, 1000000));
    const resets = await prunePasswordResets();
    resets.push({
      id: randomId(),
      userId: user.id,
      codeHash: hashResetCode(user.id, resetCode),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 15).toISOString()
    });
    await writeJson(passwordResetsFile, resets);

    if (shouldShowResetCode()) {
      response.resetCode = resetCode;
    } else {
      console.info(`Password reset code for ${cleanEmail}: ${resetCode}`);
    }
  }

  sendJson(res, 200, response);
}

async function resetPassword(req, res) {
  const { email, resetCode, password, captchaId, captchaAnswer } = await readJsonBody(req);
  if (!(await requireCaptcha(captchaId, captchaAnswer, res))) return;

  const cleanPassword = String(password || "");
  if (cleanPassword.length < 8) {
    sendJson(res, 400, { error: "Use a new password of at least 8 characters." });
    return;
  }

  const users = await readJson(usersFile, []);
  const userIndex = users.findIndex((entry) => entry.email === normalizeEmail(email));
  if (userIndex === -1) {
    sendJson(res, 400, { error: "Reset code or email did not match." });
    return;
  }

  const user = users[userIndex];
  const resets = await prunePasswordResets();
  const matchingReset = resets.find(
    (entry) => entry.userId === user.id && entry.codeHash === hashResetCode(user.id, resetCode)
  );

  if (!matchingReset) {
    sendJson(res, 400, { error: "Reset code or email did not match." });
    return;
  }

  users[userIndex] = {
    ...user,
    passwordHash: await hashPassword(cleanPassword),
    passwordUpdatedAt: new Date().toISOString()
  };

  await writeJson(usersFile, users);
  await writeJson(
    passwordResetsFile,
    resets.filter((entry) => entry.userId !== user.id)
  );

  const sessions = await readJson(sessionsFile, []);
  await writeJson(
    sessionsFile,
    sessions.filter((session) => session.userId !== user.id)
  );

  await createSession(res, users[userIndex]);
  sendJson(res, 200, { user: publicUser(users[userIndex]) });
}

async function logout(req, res) {
  const token = getCookie(req, "voice_vault_session");
  if (token) {
    const sessions = await readJson(sessionsFile, []);
    await writeJson(
      sessionsFile,
      sessions.filter((session) => session.tokenHash !== hashToken(token))
    );
  }

  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

async function createCaptcha(req, res) {
  const left = randomInt(2, 10);
  const right = randomInt(2, 10);
  const answer = String(left + right);
  const id = randomId();
  const challenges = await pruneCaptchaChallenges();

  challenges.push({
    id,
    answerHash: hashCaptchaAnswer(id, answer),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString()
  });
  await writeJson(captchaFile, challenges);

  sendJson(res, 200, {
    captcha: {
      id,
      question: `${left} + ${right} = ?`
    }
  });
}

async function requireCaptcha(captchaId, captchaAnswer, res) {
  const ok = await verifyCaptcha(captchaId, captchaAnswer);
  if (!ok) {
    sendJson(res, 400, { error: "Please solve the security check again." });
    return false;
  }
  return true;
}

async function verifyCaptcha(captchaId, captchaAnswer) {
  const id = String(captchaId || "");
  const challenges = await pruneCaptchaChallenges();
  const challenge = challenges.find((entry) => entry.id === id);
  const remaining = challenges.filter((entry) => entry.id !== id);
  await writeJson(captchaFile, remaining);

  if (!challenge) return false;
  return challenge.answerHash === hashCaptchaAnswer(id, captchaAnswer);
}

async function pruneCaptchaChallenges() {
  const now = Date.now();
  const challenges = await readJson(captchaFile, []);
  return challenges.filter((entry) => new Date(entry.expiresAt).getTime() > now);
}

async function prunePasswordResets() {
  const now = Date.now();
  const resets = await readJson(passwordResetsFile, []);
  const activeResets = resets.filter((entry) => new Date(entry.expiresAt).getTime() > now);
  if (activeResets.length !== resets.length) {
    await writeJson(passwordResetsFile, activeResets);
  }
  return activeResets;
}

async function saveRecording(req, res, user) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxUploadBytes) {
      sendJson(res, 413, { error: "Recording is too large." });
      return;
    }
    chunks.push(chunk);
  }

  if (!totalBytes) {
    sendJson(res, 400, { error: "Recording audio was empty." });
    return;
  }

  const contentType = String(req.headers["content-type"] || "audio/webm");
  if (!isAllowedAudio(contentType)) {
    sendJson(res, 415, { error: "Unsupported audio type." });
    return;
  }

  const id = randomId();
  const ext = extensionForAudio(contentType);
  const fileName = `${id}${ext}`;
  const safeTitle = cleanTitle(decodeHeader(req.headers["x-recording-title"]));
  const duration = Number(req.headers["x-recording-duration"] || 0);
  const filePath = path.join(recordingsDir, fileName);

  await fs.writeFile(filePath, Buffer.concat(chunks));

  const recordings = await readJson(recordingsFile, []);
  const recording = {
    id,
    userId: user.id,
    title: safeTitle || `Session ${new Date().toLocaleDateString("en-US")}`,
    fileName,
    mimeType: contentType.split(";")[0],
    size: totalBytes,
    duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
    createdAt: new Date().toISOString()
  };

  recordings.push(recording);
  await writeJson(recordingsFile, recordings);

  sendJson(res, 201, {
    recording: {
      id: recording.id,
      title: recording.title,
      createdAt: recording.createdAt,
      size: recording.size,
      mimeType: recording.mimeType,
      duration: recording.duration,
      url: `/api/recordings/${recording.id}/audio`
    }
  });
}

async function streamRecording(req, res, user, recordingId) {
  const recordings = await readJson(recordingsFile, []);
  const recording = recordings.find((entry) => entry.id === recordingId && entry.userId === user.id);
  if (!recording) {
    sendJson(res, 404, { error: "Recording not found." });
    return;
  }

  const filePath = path.join(recordingsDir, recording.fileName);
  const stats = await fs.stat(filePath);
  const range = req.headers.range;

  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      res.writeHead(416);
      res.end();
      return;
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : stats.size - 1;
    if (start >= stats.size || end >= stats.size) {
      res.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stats.size}`,
      "Content-Type": recording.mimeType
    });
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "Accept-Ranges": "bytes",
    "Content-Length": stats.size,
    "Content-Type": recording.mimeType
  });
  createReadStream(filePath).pipe(res);
}

async function deleteRecording(req, res, user, recordingId) {
  const recordings = await readJson(recordingsFile, []);
  const recording = recordings.find((entry) => entry.id === recordingId && entry.userId === user.id);
  if (!recording) {
    sendJson(res, 404, { error: "Recording not found." });
    return;
  }

  await fs.rm(path.join(recordingsDir, recording.fileName), { force: true });
  await writeJson(
    recordingsFile,
    recordings.filter((entry) => entry.id !== recording.id)
  );
  sendJson(res, 200, { ok: true });
}

async function createSession(res, user) {
  const token = randomBytes(32).toString("hex");
  const sessions = await readJson(sessionsFile, []);
  const now = Date.now();
  const expiresAt = new Date(now + 1000 * 60 * 60 * 24 * 30).toISOString();
  sessions.push({
    tokenHash: hashToken(token),
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt
  });

  await writeJson(sessionsFile, sessions);
  setSessionCookie(res, token, expiresAt);
}

async function getSession(req) {
  const token = getCookie(req, "voice_vault_session");
  if (!token) return null;

  const tokenHash = hashToken(token);
  const [sessions, users] = await Promise.all([readJson(sessionsFile, []), readJson(usersFile, [])]);
  const session = sessions.find((entry) => entry.tokenHash === tokenHash);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;

  const user = users.find((entry) => entry.id === session.userId);
  return user ? { session, user } : null;
}

async function requireSession(req, res) {
  const session = await getSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Please sign in first." });
    return null;
  }
  return session;
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let requestedPath = decodeURIComponent(url.pathname);
  if (requestedPath === "/") requestedPath = "/index.html";

  const filePath = path.normalize(path.join(publicDir, requestedPath));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error("Not a file");
    res.writeHead(200, {
      "Content-Length": stats.size,
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    const fallback = path.join(publicDir, "index.html");
    const stats = await fs.stat(fallback);
    res.writeHead(200, {
      "Content-Length": stats.size,
      "Content-Type": mimeTypes[".html"]
    });
    createReadStream(fallback).pipe(res);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > 1024 * 1024) {
      throw new Error("JSON body too large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(body);
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, key] = String(storedHash || "").split(":");
  if (!salt || !key) return false;

  const actual = Buffer.from(key, "hex");
  const candidate = await scrypt(password, salt, 64);
  return actual.length === candidate.length && timingSafeEqual(actual, candidate);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function hashCaptchaAnswer(id, answer) {
  return createHash("sha256")
    .update(`${id}:${String(answer || "").trim()}:captcha-v1`)
    .digest("hex");
}

function hashResetCode(userId, code) {
  return createHash("sha256")
    .update(`${userId}:${String(code || "").trim()}:password-reset-v1`)
    .digest("hex");
}

function setSessionCookie(res, token, expiresAt) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `voice_vault_session=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expiresAt).toUTCString()}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "voice_vault_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
  );
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const found = cookies.find((cookie) => cookie.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : "";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email
  };
}

function randomId() {
  return randomBytes(16).toString("hex");
}

function isAllowedAudio(contentType) {
  return ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp3", "audio/wav"].some((type) =>
    contentType.startsWith(type)
  );
}

function extensionForAudio(contentType) {
  if (contentType.startsWith("audio/ogg")) return ".ogg";
  if (contentType.startsWith("audio/mpeg") || contentType.startsWith("audio/mp3")) return ".mp3";
  if (contentType.startsWith("audio/wav")) return ".wav";
  return ".webm";
}

function cleanTitle(value) {
  return String(value || "")
    .trim()
    .replace(/[\r\n]/g, " ")
    .slice(0, 80);
}

function decodeHeader(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function shouldShowResetCode() {
  const delivery = String(process.env.PASSWORD_RESET_DELIVERY || "").toLowerCase();
  if (delivery === "screen") return true;
  if (delivery === "log") return false;
  return process.env.NODE_ENV !== "production";
}
