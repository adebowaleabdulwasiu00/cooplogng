// src/utils/ipHelper.js
// Retrieves the public IP address using a simple external service.
// Returns a string IP or null on failure. Caches result for the session.

let cachedIp = null;

export default async function getPublicIP() {
  if (cachedIp) return cachedIp;
  try {
    const resp ;
    if (!resp.ok) return null;
    const data = await resp.json();
    cachedIp = data.ip || null;
    return cachedIp;
  } catch (e) {
    return null;
  }
}
