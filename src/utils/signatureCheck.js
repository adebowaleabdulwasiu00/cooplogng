/**
 * signatureCheck.js — lightweight, offline, dependency-free heuristics that
 * guess whether an uploaded image looks like a handwritten signature.
 *
 * It does NOT verify identity and cannot tell a genuine signature from a
 * scribble. It only catches common data-entry mistakes:
 *   - 'blank' : almost no ink (blank paper / failed capture)
 *   - 'photo' : dense and/or colourful like a passport photo, not pen strokes
 *   - 'ok'    : sparse dark strokes on a light background (signature-like)
 *   - 'unreadable' : image could not be decoded (stay silent, don't nag)
 *
 * Blue biro signatures are colourful but sparse, so the photo rule requires
 * BOTH high ink coverage and high colour — sparse blue ink still passes.
 */

const MAX_DIM = 200;
const LUMA_INK = 128; // luminance below this counts as ink
const SAT_COLOUR = 40; // channel spread above this counts as colourful

const BLANK_INK_RATIO = 0.008; // less ink than this = blank
const PHOTO_INK_RATIO = 0.15; // denser than this starts looking like a photo
const PHOTO_COLOUR_RATIO = 0.15; // ...combined with this much colour
const DENSE_INK_RATIO = 0.5; // this dense is a photo even in black & white

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const owned = typeof source !== 'string';
    const img = new Image();
    const done = (fn) => (arg) => {
      if (owned) {
        try { URL.revokeObjectURL(url); } catch {}
      }
      fn(arg);
    };
    img.onload = done(() => resolve(img));
    img.onerror = done(() => reject(new Error('unreadable image')));
    img.src = url;
    // Safety net: never hang the form on a corrupt file
    setTimeout(() => reject(new Error('image load timeout')), 8000);
  });
}

/**
 * @param {File|Blob|string} source image file or data URL
 * @returns {Promise<{verdict:'ok'|'blank'|'photo'|'unreadable', inkRatio:number, message:string}>}
 */
export async function checkSignatureImage(source) {
  if (!source) {
    return { verdict: 'unreadable', inkRatio: 0, message: '' };
  }
  let img;
  try {
    img = await loadImage(source);
  } catch {
    return { verdict: 'unreadable', inkRatio: 0, message: '' };
  }
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h || w < 20 || h < 20) {
      return { verdict: 'unreadable', inkRatio: 0, message: '' };
    }
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { verdict: 'unreadable', inkRatio: 0, message: '' };
    }
    ctx.drawImage(img, 0, 0, cw, ch);
    const data = ctx.getImageData(0, 0, cw, ch).data;
    const total = cw * ch;
    let ink = 0;
    let colourful = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma < LUMA_INK) ink++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn > SAT_COLOUR) colourful++;
    }
    const inkRatio = ink / total;
    const colourRatio = colourful / total;

    if (inkRatio < BLANK_INK_RATIO) {
      return {
        verdict: 'blank',
        inkRatio,
        message: 'This signature image looks blank — please capture the signature again. You can still save if you are sure it is correct.',
      };
    }
    if (inkRatio > DENSE_INK_RATIO || (inkRatio > PHOTO_INK_RATIO && colourRatio > PHOTO_COLOUR_RATIO)) {
      return {
        verdict: 'photo',
        inkRatio,
        message: 'This looks like a photo, not a handwritten signature. Please upload the member\u2019s signature. You can still save if you are sure it is correct.',
      };
    }
    return { verdict: 'ok', inkRatio, message: '' };
  } catch {
    return { verdict: 'unreadable', inkRatio: 0, message: '' };
  }
}
