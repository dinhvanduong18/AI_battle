import React from 'react';

const POSITION_BADGES = {
  1: {
    label: 'Hạng nhất',
    medal: '#ffd323',
    inner: '#ffe77a',
    border: '#f0ad00',
    ribbon: '#ffc400',
    number: '#e89c00',
  },
  2: {
    label: 'Hạng nhì',
    medal: '#c8d9e6',
    inner: '#e5eef4',
    border: '#a9bfd0',
    ribbon: '#b8cad8',
    number: '#91aabc',
  },
  3: {
    label: 'Hạng ba',
    medal: '#dc9658',
    inner: '#efbd8b',
    border: '#c77b3f',
    ribbon: '#d58a4a',
    number: '#bd722c',
  },
} as const;

export const LeaderboardRank: React.FC<{ rank: number }> = ({ rank }) => {
  const badge = POSITION_BADGES[rank as keyof typeof POSITION_BADGES];

  return (
    <span
      className="inline-flex items-center gap-1.5"
      aria-label={badge ? `${badge.label}, vị trí ${rank}` : `Vị trí ${rank}`}
      title={badge?.label}
    >
      {badge && (
        <svg className="h-7 w-6 shrink-0" viewBox="0 0 24 30" aria-hidden="true">
          <path d="M6 16h12l1 12-7-4-7 4z" fill={badge.ribbon} />
          <circle cx="12" cy="12" r="10" fill={badge.medal} stroke={badge.border} strokeWidth="1.5" />
          <circle cx="12" cy="12" r="7" fill={badge.inner} />
          <text
            x="12"
            y="16"
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill={badge.number}
          >
            {rank}
          </text>
        </svg>
      )}
      <span>{String(rank).padStart(2, '0')}</span>
    </span>
  );
};
