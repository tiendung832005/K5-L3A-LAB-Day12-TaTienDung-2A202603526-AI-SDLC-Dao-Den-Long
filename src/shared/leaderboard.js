export const PLAYER_NAME = /^[\p{L}\p{N}_-]{3,12}$/u;

export function normalizeName(value) {
  return typeof value === 'string' ? value.normalize('NFC').trim() : '';
}
