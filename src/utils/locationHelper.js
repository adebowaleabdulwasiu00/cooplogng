// src/utils/locationHelper.js
// Helper to obtain location (city, state, country, latitude, longitude) with caching.
// Uses the browser Geolocation API and OpenStreetMap Nominatim for reverse geocoding.

const CACHE_KEY ;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get cached location if still valid.
 */
function getCachedLocation() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { timestamp, data } = JSON.parse(raw);
    if (Date.now() - timestamp < CACHE_TTL_MS) {
      return data;
    }
    // expired
    localStorage.removeItem(CACHE_KEY);
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Save location to cache.
 */
function setCachedLocation(data) {
  try {
    const payload = { timestamp: Date.now(), data };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (e) {
  }
}

/**
 * Perform reverse geocoding via Nominatim.
 */
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`;
    const resp ;
    if (!resp.ok) return null;
    const json = await resp.json();
    const addr = json.address || {};
    return {
      country: addr.country || null,
      state: addr.state || null,
      city: addr.city || addr.town || addr.village || null,
      latitude: lat,
      longitude: lon,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Main helper to obtain location.
 * Returns cached value if available, otherwise asks for permission.
 * If permission denied, returns null values.
 */
export default async function getLocation() {
  // Return cached if valid
  const cached = getCachedLocation();
  if (cached) return cached;

  if (!navigator.geolocation) {
    return null;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const data = await reverseGeocode(latitude, longitude);
        if (data) setCachedLocation(data);
        resolve(data);
      },
      (err) => {
        // Permission denied or other error – return nulls.
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
  });
}
