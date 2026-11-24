import { describe, it, expect } from "vitest";
import {
  deriveVapidPublicKey,
  dueDateMilestone,
  formatDoualaYmd,
  encryptWebPushPayload,
} from "../../src/tenant/web-push.js";

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

describe("Web Push Utilities", () => {
  it("formats dates in Africa/Douala timezone", () => {
    const d = new Date("2026-11-24T00:30:00Z"); // In Douala (+1), this is 2026-11-24 01:30
    expect(formatDoualaYmd(d)).toBe("2026-11-24");
  });

  it("calculates due date milestones correctly", () => {
    expect(dueDateMilestone("2026-12-01", "2026-11-24")).toBe("d7");
    expect(dueDateMilestone("2026-11-27", "2026-11-24")).toBe("d3");
    expect(dueDateMilestone("2026-11-25", "2026-11-24")).toBe("d1");
    expect(dueDateMilestone("2026-11-24", "2026-11-24")).toBe(null);
    expect(dueDateMilestone("2026-11-26", "2026-11-24")).toBe(null);
    expect(dueDateMilestone("2026-11-30", "2026-11-24")).toBe(null);
  });

  it("derives uncompressed VAPID public key from P-256 JWK", async () => {
    const keyPair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const pub = deriveVapidPublicKey(JSON.stringify(jwk));
    expect(pub).toBeDefined();
    expect(pub!.length).toBeGreaterThan(60);

    // Uncompressed P-256 public key starts with 0x04 and is 65 bytes
    const pubBytes = base64UrlDecode(pub!);
    expect(pubBytes.length).toBe(65);
    expect(pubBytes[0]).toBe(0x04);
  });

  it("encrypts and decrypts RFC 8291 payload successfully", async () => {
    // Generate simulated client receiver key pair (ECDH P-256) and auth secret (16 bytes)
    const clientReceiverKeyPair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;

    const clientRawPub = new Uint8Array(
      await crypto.subtle.exportKey("raw", clientReceiverKeyPair.publicKey),
    );
    const clientAuth = crypto.getRandomValues(new Uint8Array(16));

    const p256dhB64 = base64UrlEncode(clientRawPub);
    const authB64 = base64UrlEncode(clientAuth);

    const message = JSON.stringify({
      notification: {
        title: "Rappel échéance",
        body: "Votre tranche arrive à échéance dans 3 jours.",
      },
    });

    const encrypted = await encryptWebPushPayload(message, p256dhB64, authB64);
    expect(encrypted.length).toBeGreaterThan(message.length + 86);

    // Independent RFC 8291 decryption
    const salt = encrypted.slice(0, 16);
    const rs = (encrypted[16] << 24) | (encrypted[17] << 16) | (encrypted[18] << 8) | encrypted[19];
    const idlen = encrypted[20];
    const serverPub = encrypted.slice(21, 21 + idlen);
    const ciphertext = encrypted.slice(21 + idlen);

    expect(rs).toBe(4096);
    expect(idlen).toBe(65);

    const serverCryptoKey = await crypto.subtle.importKey(
      "raw",
      serverPub,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    );
    const sharedSecret = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: serverCryptoKey },
        clientReceiverKeyPair.privateKey,
        256,
      ),
    );

    const enc = new TextEncoder();
    const webpushInfoPrefix = enc.encode("WebPush: info\0");
    const authInfo = new Uint8Array(webpushInfoPrefix.length + clientRawPub.length + serverPub.length);
    authInfo.set(webpushInfoPrefix, 0);
    authInfo.set(clientRawPub, webpushInfoPrefix.length);
    authInfo.set(serverPub, webpushInfoPrefix.length + clientRawPub.length);

    const hkdfKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveBits"]);
    const prk = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: clientAuth, info: authInfo },
        hkdfKey,
        256,
      ),
    );

    const prkKey = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);
    const cek = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("Content-Encoding: aes128gcm\0") },
        prkKey,
        128,
      ),
    );
    const nonce = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("Content-Encoding: nonce\0") },
        prkKey,
        96,
      ),
    );

    const cekKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      cekKey,
      ciphertext,
    );
    const decryptedBytes = new Uint8Array(decryptedBuffer);

    // Last byte must be 0x02 delimiter
    expect(decryptedBytes[decryptedBytes.length - 1]).toBe(0x02);
    const decryptedText = new TextDecoder().decode(decryptedBytes.slice(0, -1));
    expect(decryptedText).toBe(message);
  });
});
