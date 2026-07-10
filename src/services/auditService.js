// src/services/auditService.js
// Centralized audit metadata collector.
// Returns an object with optional audit fields. Missing values are null.

import getFingerprint from '../utils/deviceFingerprint.js';
import getLocation from '../utils/locationHelper.js';
import getPublicIP from '../utils/ipHelper.js';

/**
 * Retrieves audit metadata for the current session/device.
 * This function is lightweight and caches results in localStorage.
 * It never throws; on failure it returns null fields.
 */
export async function getAuditMetadata() {
  try {
    const fingerprint = await getFingerprint(); // {device_id, device_type, browser, browser_version, operating_system, screen_resolution, timezone}
    const location = await getLocation(); // {country, state, city, latitude, longitude}
    const ip = await getPublicIP(); // string or null

    return {
      device_id: fingerprint.device_id || null,
      device_name: null, // Not readily available in browser context.
      device_type: fingerprint.device_type || null,
      browser: fingerprint.browser || null,
      browser_version: fingerprint.browser_version || null,
      operating_system: fingerprint.operating_system || null,
      screen_resolution: fingerprint.screen_resolution || null,
      timezone: fingerprint.timezone || null,
      ip_address: ip,
      country: location?.country || null,
      state: location?.state || null,
      city: location?.city || null,
      latitude: location?.latitude || null,
      longitude: location?.longitude || null,
    };
  } catch (e) {
    // Return object with all nulls to avoid breaking business logic.
    return {
      device_id: null,
      device_name: null,
      device_type: null,
      browser: null,
      browser_version: null,
      operating_system: null,
      screen_resolution: null,
      timezone: null,
      ip_address: null,
      country: null,
      state: null,
      city: null,
      latitude: null,
      longitude: null,
    };
  }
}

export default { getAuditMetadata };
