const AVATAR_CLASSES = [
  'bg-[hsl(var(--avatar-1))]',
  'bg-[hsl(var(--avatar-2))]',
  'bg-[hsl(var(--avatar-3))]',
  'bg-[hsl(var(--avatar-4))]',
  'bg-[hsl(var(--avatar-5))]',
  'bg-[hsl(var(--avatar-6))]',
  'bg-[hsl(var(--avatar-7))]',
  'bg-[hsl(var(--avatar-8))]',
];

// FNV-1a, deterministic so a sender's avatar color stays stable forever.
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function avatarColorClass(email: string): string {
  const index = fnv1aHash(email.toLowerCase()) % AVATAR_CLASSES.length;
  return AVATAR_CLASSES[index];
}

export function initialsFor(name: string | undefined, email: string): string {
  const source = name && name.trim().length > 0 ? name : email;
  const parts = source.trim().split(/\s+/);
  const initials = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return initials.toUpperCase();
}
