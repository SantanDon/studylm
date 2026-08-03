import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function stripIpv6Brackets(value) {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function isPublicIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address) {
  const normalized = stripIpv6Brackets(address).split('%')[0].toLowerCase();
  if (normalized === '::' || normalized === '::1') return false;
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')) return false;
  if (normalized.startsWith('2001:db8:')) return false;

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);

  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPublicIpv4([
      high >> 8,
      high & 255,
      low >> 8,
      low & 255,
    ].join('.'));
  }

  return true;
}

export function isPublicIpAddress(address) {
  const normalized = stripIpv6Brackets(String(address || ''));
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

export function parseExternalHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('Webhook URL must be a valid HTTPS URL.');
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new Error('Webhook URL must use standard HTTPS without embedded credentials.');
  }

  const hostname = stripIpv6Brackets(parsed.hostname).toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Webhook URL must use a public hostname.');
  }
  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new Error('Webhook URL cannot target a private or reserved network.');
  }
  return parsed;
}

export async function assertSafeExternalHttpsUrl(value) {
  const parsed = parseExternalHttpsUrl(value);
  if (!isIP(stripIpv6Brackets(parsed.hostname))) {
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
      throw new Error('Webhook hostname does not resolve exclusively to public addresses.');
    }
  }
  return parsed.toString();
}
