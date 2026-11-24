// Web Push RFC 8292 (VAPID) + RFC 8291 / RFC 8188 (aes128gcm) pure WebCrypto implementation.

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function formatDoualaYmd(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Douala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date); // YYYY-MM-DD
}

export function dueDateMilestone(
  dueDateYmd: string,
  todayYmd: string,
): "d7" | "d3" | "d1" | null {
  const due = new Date(dueDateYmd + "T00:00:00Z").getTime();
  const today = new Date(todayYmd + "T00:00:00Z").getTime();
  const diffDays = Math.round((due - today) / (86400 * 1000));
  if (diffDays === 7) return "d7";
  if (diffDays === 3) return "d3";
  if (diffDays === 1) return "d1";
  return null;
}

export interface VapidJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
}

export function deriveVapidPublicKey(privateJwkJson: string): string | null {
  try {
    if (!privateJwkJson || !privateJwkJson.includes("crv")) return null;
    const jwk = JSON.parse(privateJwkJson) as VapidJwk;
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) return null;
    const xBytes = base64UrlDecode(jwk.x);
    const yBytes = base64UrlDecode(jwk.y);
    const uncompressed = new Uint8Array(1 + xBytes.length + yBytes.length);
    uncompressed[0] = 0x04;
    uncompressed.set(xBytes, 1);
    uncompressed.set(yBytes, 1 + xBytes.length);
    return base64UrlEncode(uncompressed);
  } catch {
    return null;
  }
}

async function createVapidJwt(
  audience: string,
  subject: string,
  privateJwkJson: string,
): Promise<{ token: string; publicKeyB64Url: string }> {
  const jwk = JSON.parse(privateJwkJson) as VapidJwk;
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );

  const publicKeyB64Url = deriveVapidPublicKey(privateJwkJson)!;
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 12 * 3600,
    sub: subject,
  };

  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    enc.encode(signingInput),
  );

  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return {
    token: `${signingInput}.${sigB64}`,
    publicKeyB64Url,
  };
}

async function hkdfExtractAndExpand(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    ikm as unknown as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      info: info as unknown as BufferSource,
    },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function encryptWebPushPayload(
  payloadText: string,
  clientPublicKeyB64Url: string,
  clientAuthB64Url: string,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const clientPublicKeyBytes = base64UrlDecode(clientPublicKeyB64Url);
  const clientAuthBytes = base64UrlDecode(clientAuthB64Url);

  const localKeyPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;

  const localPublicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKeyPair.publicKey),
  );

  const clientCryptoKey = await crypto.subtle.importKey(
    "raw",
    clientPublicKeyBytes as unknown as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientCryptoKey },
      localKeyPair.privateKey,
      256,
    ),
  );

  // RFC 8291 section 3.2
  // authInfo = "WebPush: info\0" || clientPublicKey || localPublicKey
  const webpushInfoPrefix = enc.encode("WebPush: info\0");
  const authInfo = new Uint8Array(
    webpushInfoPrefix.length + clientPublicKeyBytes.length + localPublicKeyBytes.length,
  );
  authInfo.set(webpushInfoPrefix, 0);
  authInfo.set(clientPublicKeyBytes, webpushInfoPrefix.length);
  authInfo.set(localPublicKeyBytes, webpushInfoPrefix.length + clientPublicKeyBytes.length);

  // IKM = HKDF-Extract(salt = clientAuth, ikm = sharedSecret)
  // PRK = HKDF-Expand(IKM, authInfo, 32)
  const prk = await hkdfExtractAndExpand(clientAuthBytes, sharedSecret, authInfo, 32);

  // Generate random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8188 section 2.1
  const cekInfo = enc.encode("Content-Encoding: aes128gcm\0");
  const cek = await hkdfExtractAndExpand(salt, prk, cekInfo, 16);

  const nonceInfo = enc.encode("Content-Encoding: nonce\0");
  const nonce = await hkdfExtractAndExpand(salt, prk, nonceInfo, 12);

  // Payload with RFC 8188 0x02 record delimiter
  const payloadBytes = enc.encode(payloadText);
  const padded = new Uint8Array(payloadBytes.length + 1);
  padded.set(payloadBytes, 0);
  padded[payloadBytes.length] = 0x02;

  const cekKey = await crypto.subtle.importKey(
    "raw",
    cek as unknown as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as unknown as BufferSource, tagLength: 128 },
    cekKey,
    padded as unknown as BufferSource,
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);

  // RFC 8188 header:
  // salt (16 bytes) || rs (4 bytes = 4096) || idlen (1 byte = 65) || localPublicKey (65 bytes)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + localPublicKeyBytes.length);
  header.set(salt, 0);
  header[16] = (rs >> 24) & 0xff;
  header[17] = (rs >> 16) & 0xff;
  header[18] = (rs >> 8) & 0xff;
  header[19] = rs & 0xff;
  header[20] = localPublicKeyBytes.length;
  header.set(localPublicKeyBytes, 21);

  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header, 0);
  body.set(ciphertext, header.length);
  return body;
}

export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payloadJson: string,
  vapidPrivateJwkJson: string,
  subject = "mailto:support@autoecole.cm",
): Promise<{ ok: boolean; status: number; gone: boolean }> {
  try {
    const endpointUrl = new URL(subscription.endpoint);
    const audience = endpointUrl.origin;
    const { token, publicKeyB64Url } = await createVapidJwt(
      audience,
      subject,
      vapidPrivateJwkJson,
    );

    const body = await encryptWebPushPayload(
      payloadJson,
      subscription.p256dh,
      subscription.auth,
    );

    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: "86400",
        Urgency: "high",
        Authorization: `vapid t=${token}, k=${publicKeyB64Url}`,
      },
      body: body as unknown as BodyInit,
    });

    const gone = res.status === 404 || res.status === 410;
    return {
      ok: res.ok,
      status: res.status,
      gone,
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      gone: false,
    };
  }
}
