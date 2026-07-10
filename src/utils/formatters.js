export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amount)
}

/**
 * Formats a number to 2 decimal places with thousands separators, no currency symbol.
 */
export function formatNumber(amount) {
  const isInteger = amount % 1 === 0;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Extracts milliseconds from various date formats (String, ISO, Firebase Timestamp)
 */
export function getTimestampMs(dateVal) {
  if (!dateVal) return 0
  
  // Handle Firestore Timestamp (Object with seconds/nanoseconds)
  if (typeof dateVal === 'object') {
    if (typeof dateVal.toDate === 'function') return dateVal.toDate().getTime()
    if (dateVal.seconds !== undefined) return dateVal.seconds * 1000
    if (dateVal._seconds !== undefined) return dateVal._seconds * 1000
  }
  
  // Handle Date object or ISO string
  const d = new Date(dateVal)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

/**
 * Formats a date for display: DD MMM, YYYY (e.g. 18 Apr, 2026)
 */
export function formatDate(dateVal) {
    if (!dateVal) return '';
    const ms = getTimestampMs(dateVal);
    if (ms === 0) return String(dateVal);
    
    const date = new Date(ms);
    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();

    return `${day} ${month}, ${year}`;
}

/**
 * Formats a date with time for display: DD MMM, YYYY HH:MM AM/PM (e.g. 23 Jun, 2026 02:45 PM)
 */
export function formatDateTime(dateVal) {
    if (!dateVal) return '';
    const ms = getTimestampMs(dateVal);
    if (ms === 0) return String(dateVal);
    
    const date = new Date(ms);
    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();
    
    let hours = date.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, '0');
    const minutesStr = String(date.getMinutes()).padStart(2, '0');

    return `${day} ${month}, ${year} ${hoursStr}:${minutesStr} ${ampm}`;
}

/**
 * Formats a date for <input type="date">: YYYY-MM-DD
 */
export function formatDateForInput(dateVal) {
    if (!dateVal) return ''
    const ms = getTimestampMs(dateVal)
    if (ms === 0) return ''
    
    const date = new Date(ms)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    
    return `${year}-${month}-${day}`
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

export function generateId(cooperativeId) {
    const prefix = cooperativeId ? cooperativeId.slice(0, 5) : '';
    const uuid = crypto.randomUUID();
    return prefix ? `${prefix}-${uuid}` : uuid;
}

export function generateRemittanceId(cooperativeId, isAutogen = false) {
    const prefix = cooperativeId.slice(0, 5);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const datetime = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return isAutogen ? `${prefix}-AUTOGEN-${datetime}` : `${prefix}-${datetime}`;
}

/**
 * Hashes a password using SHA-256 (Web Crypto API with JS Fallback)
 */
export async function hashPassword(password) {
    if (!password) return "";
    
    // Attempt Web Crypto API first
    if (window.crypto && window.crypto.subtle) {
        try {
            const msgBuffer = new TextEncoder().encode(password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            console.warn("Web Crypto failed, using fallback:", e);
        }
    }

    // Pure JS Fallback (Minimal SHA-256 implementation)
    console.log("Using JS Fallback for hashing...");
    const sha256 = (ascii) => {
        function rightRotate(value, amount) {
            return (value >>> amount) | (value << (32 - amount));
        }
        
        const Math_pow = Math.pow;
        const maxWord = Math_pow(2, 32);
        const lengthProperty = 'length'
        let i, j; // Used as a counter across the whole file
        let result = ''

        const words = [];
        const asciiBitLength = ascii[lengthProperty] * 8;
        
        //* caching results for performance
        let hash = sha256.h = sha256.h || [];
        let k = sha256.k = sha256.k || [];
        let primeCounter = k[lengthProperty];

        const isPrime = (n) => {
            for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
            return true;
        }

        const getFractionalBits = (n) => ((n - Math.floor(n)) * maxWord) | 0;

        for (let n = 2; primeCounter < 64; n++) {
            if (isPrime(n)) {
                if (primeCounter < 8) hash[primeCounter] = getFractionalBits(Math_pow(n, 1 / 2));
                k[primeCounter] = getFractionalBits(Math_pow(n, 1 / 3));
                primeCounter++;
            }
        }
        
        ascii += '\x80' // Append '1' bit (plus zero padding)
        while (ascii[lengthProperty] % 64 - 56) ascii += '\x00' // More zero padding
        for (i = 0; i < ascii[lengthProperty]; i++) {
            j = ascii.charCodeAt(i);
            if (j >> 8) return; // ASCII check: only accept characters in range 0-255
            words[i >> 2] |= j << ((3 - i % 4) * 8);
        }
        words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
        words[words[lengthProperty]] = (asciiBitLength | 0)

        for (j = 0; j < words[lengthProperty]; ) {
            const w = words.slice(j, j += 16); // The message is expanded into 64 words
            const oldHash = hash;
            hash = hash.slice(0, 8);
            
            for (i = 0; i < 64; i++) {
                const w15 = w[i - 15], w2 = w[i - 2];
                const a = hash[0], e = hash[4];
                const temp1 = hash[7]
                    + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) // S1
                    + ((e & hash[5]) ^ (~e & hash[6])) // ch
                    + k[i]
                    + (w[i] = (i < 16) ? w[i] : (
                            w[i - 16]
                            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) // s0
                            + w[i - 7]
                            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10)) // s1
                        ) | 0
                    );
                const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) // S0
                    + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2])); // maj
                
                hash = [(temp1 + temp2) | 0].concat(hash);
                hash[4] = (hash[4] + temp1) | 0;
            }
            
            for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
        }
        
        for (i = 0; i < 8; i++) {
            for (j = 3; j + 1; j--) {
                const b = (hash[i] >> (j * 8)) & 255;
                result += ((b < 16) ? '0' : '') + b.toString(16);
            }
        }
        return result;
    };

    return sha256(password);
}

/**
 * Generates a random 4-digit numeric string
 */
export function generateRandom4Digit() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Generates initials from a full name (up to 2 characters)
 */
export function getInitials(name) {
    if (!name) return '';
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Converts a native <input type="date"> into a custom formatted date input
 * that shows "DD MMM, YYYY" but uses the native date picker
 * @param {HTMLInputElement} dateInput - The original input type="date" element
 */
export function wrapDateInput(dateInput) {
    if (!dateInput || dateInput.type !== 'date') return;
    
    // Create wrapper div
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.style.width = '100%';
    wrapper.style.cursor = 'pointer';
    
    // Create formatted display input
    const displayInput = document.createElement('input');
    displayInput.type = 'text';
    displayInput.readOnly = true;
    displayInput.style.width = '100%';
    displayInput.style.boxSizing = 'border-box';
    displayInput.style.cursor = 'pointer';
    displayInput.style.pointerEvents = 'none';
    displayInput.className = dateInput.className; // Copy original classes
    
    // Update display input whenever date input changes
    const updateDisplay = () => {
        if (dateInput.value) {
            displayInput.value = formatDate(dateInput.value);
        } else {
            displayInput.value = '';
        }
    };
    
    dateInput.addEventListener('change', updateDisplay);
    dateInput.addEventListener('input', updateDisplay);
    
    // When wrapper is clicked, open the native date picker
    wrapper.addEventListener('click', (e) => {
        if (e.target === dateInput) return;
        try {
            if (typeof dateInput.showPicker === 'function') {
                dateInput.showPicker();
            } else {
                dateInput.click();
            }
        } catch (err) {
            dateInput.click();
        }
    });
    
    // Insert wrapper and display input in the DOM
    dateInput.parentNode.insertBefore(wrapper, dateInput);
    wrapper.appendChild(displayInput);
    wrapper.appendChild(dateInput);
    
    // Hide original date input but keep it functional
    dateInput.style.position = 'absolute';
    dateInput.style.top = '0';
    dateInput.style.left = '0';
    dateInput.style.width = '100%';
    dateInput.style.height = '100%';
    dateInput.style.opacity = '0';
    dateInput.style.cursor = 'pointer';
    dateInput.style.boxSizing = 'border-box';
    dateInput.style.pointerEvents = 'none';
    
    // Initialize display
    updateDisplay();
    
    return displayInput;
}
