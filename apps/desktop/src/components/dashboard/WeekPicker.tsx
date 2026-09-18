import React, { useState } from 'react';

export interface WeekPickerProps {
  value: string; // ISO string YYYY-MM-DD (Monday)
  onChange: (isoMonday: string) => void;
  label?: string;
}

// Helper: get Monday for any date
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Sunday -> previous Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Helper: format week range
function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${monday.toLocaleDateString()} – ${sunday.toLocaleDateString()}`;
}

export const WeekPicker: React.FC<WeekPickerProps> = ({ value, onChange, label }) => {
  const [inputValue, setInputValue] = useState(value);

  // When user picks a date, snap to Monday
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = new Date(e.target.value);
    const monday = getMonday(picked);
    const isoMonday = monday.toISOString().substring(0, 10);
    setInputValue(isoMonday);
    onChange(isoMonday);
  }

  const monday = getMonday(new Date(inputValue));
  const weekLabel = formatWeekRange(monday);

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor="week-picker" className="text-xs font-medium text-gray-400">
          {label}
        </label>
      )}
      <input
        id="week-picker"
        type="date"
        value={inputValue}
        onChange={handleChange}
        className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
      />
      <span className="text-xs text-gray-400 mt-1">Týden: <span className="text-gray-100">{weekLabel}</span></span>
    </div>
  );
};
