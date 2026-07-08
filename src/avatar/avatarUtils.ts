import type { Avatar } from '../types';
import { fnv1a } from '../util/hash';

/** accent palette tuned for the dark UI — used for initials chips and borders */
export const AVATAR_COLORS = [
  '#f4845f', // coral
  '#f9c74f', // amber
  '#90be6d', // leaf
  '#43aa8b', // teal
  '#4d9de0', // sky
  '#7b6ff0', // violet
  '#e15b97', // magenta
  '#3bceac', // mint
  '#e0a458', // ochre
  '#9bc53d', // lime
];

// One emoji = one identity. Every entry is a distinct character, persona,
// passion, or signature vibe someone can claim as "theirs" — no near-duplicate
// variants (one star, not three) and no interchangeable filler (assorted fruit,
// leaves, trees, flowers). Kept to simple single-codepoint emoji (no ZWJ
// families, flags, or skin tones) so they render consistently at chip size. The
// palette ships in the bundle, not in links — only a person's CHOSEN emoji
// travels — so its length has no effect on link size.
export const AVATAR_EMOJI = [
  // spirit animals — each reads as its own character
  '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🦉', '🦅', '🦇',
  '🐺', '🦄', '🐙', '🐉', '🦖', '🐝', '🦋', '🐢', '🐍', '🦎',
  '🦈', '🐬', '🐧', '🦩', '🦜', '🦚', '🦔', '🦥', '🦦', '🦫',
  '🐘', '🦏', '🦒', '🦘', '🦓', '🦍', '🐊', '🦂', '🐞', '🐰',
  '🐷', '🐴', '🐡',
  // personas — pick who you are
  '🤖', '👽', '👻', '🤡', '💀', '👾', '🎃', '🥷', '🤠', '🧙',
  '🧚', '🧛', '🧟', '🧞', '🦸', '🦹', '🧜', '🧝',
  // passions — sport, music, art, science, adventure
  '🎮', '🎸', '🎹', '🎺', '🎷', '🥁', '🎧', '🎤', '🎨', '🎭',
  '🎬', '📚', '🔭', '🔬', '🧠', '🚀', '🛸', '🏀', '⚽', '🏈',
  '⚾', '🎾', '🏓', '🛹', '🚲', '⛵', '🏄', '🏂', '🎯', '🎲',
  '🧩', '🎳', '🥊', '🎣',
  // signature vibes, elements & objects
  '🔥', '⚡', '🌙', '🌈', '⛄', '🌵', '🍄', '🌻', '🌊', '💎',
  '👑', '🔮', '🎩', '🪄', '🧭', '⚓', '✨',
  // foodie identities
  '🍕', '🌮', '🍔', '🍜', '🍣', '🍩', '🧁', '🧋', '☕', '🥑',
];

export function initialsFor(handle: string): string {
  const words = handle.trim().split(/\s+/);
  const chars = words.length >= 2 ? words[0][0] + words[1][0] : handle.trim().slice(0, 2);
  return chars.toUpperCase();
}

export function colorFor(handle: string): string {
  const idx = parseInt(fnv1a(handle.trim().toLowerCase()), 16) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

export function defaultAvatar(handle: string): Avatar {
  return { kind: 'initials', initials: initialsFor(handle), color: colorFor(handle) };
}

const AVATAR_SIZE = 96;

/**
 * Downscale an uploaded photo to a 96×96 center-cropped JPEG data URL.
 * Small enough for localStorage + JSON export; share links strip it anyway.
 */
export function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas unavailable'));
      ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}
