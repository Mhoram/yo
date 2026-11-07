import { useId, useMemo, useRef, useState } from 'react';
import type { KnownContact } from '../lib/api';
import { useContacts } from '../hooks/useContacts';

function contactsFor(token: string, contacts: KnownContact[]): KnownContact[] {
  if (token.length === 0) return contacts;
  return contacts.filter(
    (c) => c.email.toLowerCase().includes(token) || (c.name?.toLowerCase().includes(token) ?? false),
  );
}

// Once the token already IS a complete address, drop it from the
// suggestions — it's fully typed (or just selected), not something still
// being completed.
function dedupeExact(token: string, contacts: KnownContact[]): KnownContact[] {
  return contacts.filter((c) => c.email.toLowerCase() !== token);
}

const fieldClass =
  'w-full rounded-md border border-border bg-background p-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary';

interface RecipientFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Addresses already entered in other fields, so they aren't suggested twice. */
  exclude: string[];
}

// Comma-separated recipient input with autocomplete over known contacts
// (sent-mail recipients + approved senders, from the local contacts cache).
// Kept as a plain comma-separated text input — same shape Compose has always
// parsed — with a suggestion dropdown layered on top, so nothing about the
// send path changes.
export function RecipientField({ value, onChange, placeholder, exclude }: RecipientFieldProps) {
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: contacts = [] } = useContacts();

  // Text after the last comma is the token currently being typed.
  const token = useMemo(() => {
    const lastComma = value.lastIndexOf(',');
    return value.slice(lastComma + 1).trim().toLowerCase();
  }, [value]);

  const suggestions = useMemo(() => {
    const excluded = new Set(exclude.map((e) => e.toLowerCase()));
    return dedupeExact(token, contactsFor(token, contacts))
      .filter((c) => !excluded.has(c.email.toLowerCase()))
      .slice(0, 6);
  }, [token, exclude, contacts]);

  function select(contact: KnownContact) {
    const lastComma = value.lastIndexOf(',');
    const before = lastComma >= 0 ? value.slice(0, lastComma + 1) + ' ' : '';
    // No trailing comma: completing one address shouldn't presume another
    // is coming. The user types the comma themselves to start the next
    // address; the send path splits on commas either way.
    onChange(`${before}${contact.email}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const s = suggestions[highlight];
      if (s) {
        e.preventDefault();
        select(s);
      }
    } else if (e.key === 'Escape') {
      setHighlight(-1);
    }
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(0);
        }}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setFocused(true);
          setHighlight(0);
        }}
        onBlur={() => {
          // Delay so clicking a suggestion (mousedown fires before blur
          // finishes) still selects it.
          blurTimer.current = setTimeout(() => setFocused(false), 150);
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={focused && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        className={fieldClass}
        autoComplete="off"
      />
      {focused && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg"
        >
          {suggestions.map((c, i) => (
            <li key={c.email} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep input focused; selection happens on click
                  select(c);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${
                  i === highlight ? 'bg-primary/10' : ''
                }`}
              >
                <span className="text-foreground">{c.name ?? c.email}</span>
                {c.name && <span className="truncate text-xs text-muted-foreground">{c.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
