export function readSessionJson(key, fallback = null) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeSessionJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readSessionString(key, fallback = '') {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeSessionString(key, value) {
  try {
    sessionStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function removeSessionKey(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore storage unavailability in restricted browsing contexts.
  }
}

export function removeSessionKeysByPrefix(prefixes) {
  try {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Ignore storage unavailability in restricted browsing contexts.
  }
}

export function hasSessionKeyPrefix(prefix) {
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(prefix)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function todayLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
