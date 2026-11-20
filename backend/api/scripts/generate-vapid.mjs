// Prints a fresh VAPID key pair and push encryption key for .env. Never commit the output.
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=mailto:ops@example.org`);
console.log(`PUSH_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`);
