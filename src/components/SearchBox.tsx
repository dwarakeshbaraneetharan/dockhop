"use client";

import { useEffect, useRef, useState } from "react";

import { geocode, type GeocodeResult } from "@/lib/api";

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: GeocodeResult) => void;
}

export function SearchBox({ value, onChange, onSelect }: SearchBoxProps) {
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const justSelected = useRef(false);

  useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }

    // Debounced so typing does not fire a request per keystroke. Clearing runs
    // inside the timer too, so nothing sets state during the effect itself.
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (value.trim().length < 3) {
        setResults([]);
        return;
      }
      geocode(value, controller.signal)
        .then((response) => {
          setResults(response.results);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        placeholder="Where to? Or tap the map"
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base shadow-lg outline-none placeholder:text-slate-400 focus:border-slate-900"
      />

      {open && results.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl bg-white shadow-xl">
          {results.map((result) => (
            <li key={`${result.lat},${result.lon},${result.label}`}>
              <button
                type="button"
                onClick={() => {
                  justSelected.current = true;
                  onSelect(result);
                  setOpen(false);
                  setResults([]);
                }}
                className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50"
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
