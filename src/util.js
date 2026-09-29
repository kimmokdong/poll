import * as crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

// 방 코드는 숫자 5자리다. 학생·교사가 휴대폰 숫자 자판으로 바로 입력하고 TV에서도 읽기 쉽다.
export const CODE_CHARS = '0123456789';
export const CODE_LENGTH = 5;

export function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function id(prefix = '') {
  return prefix + randomHex(8);
}

export function roomCode() {
  return Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
}

export function cleanText(value, max = 50) {
  return String(value ?? '').trim().replace(/[<>]/g, '').slice(0, max);
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

export function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function pick(items) {
  return items[crypto.randomInt(items.length)];
}

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function pinHash(pin, salt) {
  return crypto.createHash('sha256').update(`${salt}:${String(pin)}`).digest('hex');
}

export function secureEqual(left, right) {
  const a = Buffer.from(left || '', 'hex');
  const b = Buffer.from(right || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function clientError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function authError(message) {
  return clientError(message, 401);
}
