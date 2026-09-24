import { useState } from 'react';
import { avatarColorClass, initialsFor } from '../lib/avatarColor';
import { useSenderLogo } from '../hooks/useSenderLogo';

const SIZE_CLASSES = {
  sm: { box: 'h-8 w-8', text: 'text-xs' },
  md: { box: 'h-12 w-12', text: 'text-base' },
};

// Shows a sender's real logo when one is available via BIMI (see
// server/src/lib/bimiLookup.ts), falling back to the existing
// initials-on-a-color-circle avatar for the (still-common) case where it
// isn't; also the fallback for a logo URL that fails to actually load.
export function Avatar({
  email,
  name,
  size = 'md',
  boxClassName,
  textClassName,
}: {
  email: string;
  name?: string;
  size?: 'sm' | 'md';
  // Escape hatch for a one-off custom size a named preset doesn't cover:
  // real Tailwind classes (can include responsive variants, unlike an
  // inline style), overriding the box/initials-text sizing from `size`.
  boxClassName?: string;
  textClassName?: string;
}) {
  const { data } = useSenderLogo(email || undefined);
  const [imageFailed, setImageFailed] = useState(false);
  const logoUrl = imageFailed ? null : (data?.logoUrl ?? null);

  const boxClass = boxClassName ?? SIZE_CLASSES[size].box;
  const textClass = textClassName ?? SIZE_CLASSES[size].text;

  if (logoUrl) {
    return (
      <span className={`flex ${boxClass} shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-1.5`}>
        <img src={logoUrl} alt="" className="h-full w-full object-contain" onError={() => setImageFailed(true)} />
      </span>
    );
  }

  return (
    <span
      className={`flex ${boxClass} shrink-0 items-center justify-center rounded-full font-semibold text-white ${textClass} ${avatarColorClass(
        email,
      )}`}
    >
      {initialsFor(name, email || '?')}
    </span>
  );
}
