// src/utils/deviceFingerprint.js
// Lightweight fingerprint generator using browser APIs.
// Caches result in localStorage (no TTL needed as it rarely changes).

/**
 * Hash a string using SHA‑256 and return a hex string.
 */
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer ;
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b ;
}

/**
 * Determine device type based on userAgent.
 */
function getDeviceType() {
  const ua ;
  if (/Mobi|Android|iPhone|iPad|Tablet/.test(ua)) {
    if (/Tablet/.test(ua) || (/iPad/.test(ua) && !/Mobile/.test(ua))) return 'Tablet';
    return 'Mobile';
  }
  return 'Desktop';
}

/**
 * Parse browser name and version from userAgent.
 */
function getBrowserInfo() {
  const ua ;
  const tem = [];
  let M = ua.match(/(opera|chrome|safari|firefox|edge|msie|trident(?=\/))/i) || [];
  if (/trident/i.test(M[1])) {
    const rv = ua.match(/rv:(\d+\.\d+)/) || [];
    return { name: 'IE', version: rv[1] || '' };
  }
  if (M[1] ;
    if (edge) return { name: 'Edge', version: edge[1] };
  }
  M ;
  const versionMatch = ua.match(/version\/([\d.]+)/i);
  if (versionMatch) M.splice(1, 1, versionMatch[1]);
  return { name: M[0], version: M[1] };
}

/**
 * Get operating system from userAgent.
 */
function getOS() {
  const platform ;
  const ua ;
  const osList ;
  for (const os of osList) {
    if (os.test.test(platform) || os.test.test(ua)) return os.name;
  }
  return 'Unknown';
}

/**
 * Retrieve fingerprint data, cache it, and return.
 */
export default async function getFingerprint() {
  try {
    const cached ;
    if (cached) {
      return JSON.parse(cached);
    }
    const deviceType = getDeviceType();
    const { name: browser, version: browserVersion } = getBrowserInfo();
    const operatingSystem = getOS();
    const screenResolution = `${window.screen.width}x${window.screen.height}`;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const raw = `${deviceType}|${browser}|${browserVersion}|${operatingSystem}|${screenResolution}|${timezone}`;
    const device_id = await sha256(raw);
    const fingerprint = {
      device_id,
      device_type: deviceType,
      browser,
      browser_version: browserVersion,
      operating_system: operatingSystem,
      screen_resolution: screenResolution,
      timezone,
    };
    localStorage.setItem('deviceFingerprint', JSON.stringify(fingerprint));
    return fingerprint;
  } catch (e) {
    return {
      device_id: null,
      device_type: null,
      browser: null,
      browser_version: null,
      operating_system: null,
      screen_resolution: null,
      timezone: null,
    };
  }
}
