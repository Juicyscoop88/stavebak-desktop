import { useEffect, useRef } from 'react';
import { CaretUp, CaretDown, X } from '@phosphor-icons/react';

interface FindBarProps {
  query: string;
  setQuery: (q: string) => void;
  matchIndex: number;
  matchCount: number;
  next: () => void;
  prev: () => void;
  close: () => void;
}

export function FindBar({ query, setQuery, matchIndex, matchCount, next, prev, close }: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus on mount
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  return (
    <div className="absolute top-2 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-lg shadow-md
      bg-bg-card border border-border text-text-primary text-sm"
      style={{ minWidth: 260 }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.shiftKey ? prev() : next();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
        placeholder="Find…"
        className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-text-muted"
      />
      <span className="text-text-tertiary text-xs whitespace-nowrap tabular-nums">
        {query ? `${matchCount > 0 ? matchIndex + 1 : 0}/${matchCount}` : ''}
      </span>
      <button
        onClick={prev}
        disabled={matchCount === 0}
        className="p-0.5 rounded hover:bg-bg-secondary disabled:opacity-30 transition-colors"
        title="Previous (Shift+Enter)"
      >
        <CaretUp size={14} weight="light" />
      </button>
      <button
        onClick={next}
        disabled={matchCount === 0}
        className="p-0.5 rounded hover:bg-bg-secondary disabled:opacity-30 transition-colors"
        title="Next (Enter)"
      >
        <CaretDown size={14} weight="light" />
      </button>
      <button
        onClick={close}
        className="p-0.5 rounded hover:bg-bg-secondary transition-colors ml-0.5"
        title="Close (Esc)"
      >
        <X size={14} weight="light" />
      </button>
    </div>
  );
}
