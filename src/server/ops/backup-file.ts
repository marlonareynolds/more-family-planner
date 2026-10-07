import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Backup } from "./backup";

/**
 * Backup files are gzipped JSON, encrypted with AES-256-GCM when a
 * passphrase is given (spec section 15: backups encrypted and
 * access-restricted). Layout: MAGIC, 16-byte salt, 12-byte IV, 16-byte tag,
 * ciphertext. The key comes from the passphrase through scrypt.
 */
const MAGIC = Buffer.from("MOREBK1\n");

export function encodeBackup(backup: Backup, passphrase?: string): Buffer {
  const plain = gzipSync(JSON.stringify(backup));
  if (!passphrase) return plain;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decodeBackup(file: Buffer, passphrase?: string): Backup {
  let plain = file;
  if (file.subarray(0, MAGIC.length).equals(MAGIC)) {
    if (!passphrase) throw new Error("This backup is encrypted; set BACKUP_PASSPHRASE.");
    const o = MAGIC.length;
    const salt = file.subarray(o, o + 16);
    const iv = file.subarray(o + 16, o + 28);
    const tag = file.subarray(o + 28, o + 44);
    const decipher = createDecipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(file.subarray(o + 44)), decipher.final()]);
  }
  return JSON.parse(gunzipSync(plain).toString("utf8")) as Backup;
}
