import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { PieceTypeName } from '../core/ottEngine';

interface MascotPieceProps {
  type: PieceTypeName;
  team: 1 | 2;
  className?: string;
}

/**
 * 2D Flat Chibi Halloween Mascots for OTTv2:
 * - rock     ("Đấm") -> Bí Ngô (Plump Chibi Pumpkin)
 * - paper    ("Lá")  -> Bé Ma  (Cute Wavy Sheet Ghost)
 * - scissors ("Kéo") -> Dơi Nhỏ (Cute Spread-Wing Bat)
 *
 * Team 1: Warm Amber-Orange palette
 * Team 2: Vivid Lavender-Violet palette
 */
export const HalloweenMascotPiece: React.FC<MascotPieceProps> = ({
  type,
  team,
  className = 'w-8 h-8',
}) => {
  const isP1 = team === 1;

  if (type === 'rock') {
    // BÍ NGÔ CHIBI (HỆ ĐẤM / ROCK)
    const bodyOuter = isP1 ? '#f97316' : '#a855f7';
    const bodyCenter = isP1 ? '#fb923c' : '#c084fc';
    const outline = isP1 ? '#fff7ed' : '#faf5ff';
    const stemFill = isP1 ? '#4ade80' : '#34d399';
    const faceFill = isP1 ? '#2b0f04' : '#240a3d';
    const cheekFill = isP1 ? '#fde047' : '#67e8f9';

    return (
      <svg viewBox="0 0 44 44" className={className} aria-hidden="true">
        {/* Cute Curved Pumpkin Stem */}
        <path
          d="M20.5 11 C20.5 6.5, 24 4.5, 26.5 5.5 C25 7.5, 24.5 9.2, 24.5 11 Z"
          fill={stemFill}
          stroke={outline}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Outer Plump Pumpkin Silhouette */}
        <rect
          x="6"
          y="10.5"
          width="32"
          height="26.5"
          rx="13"
          fill={bodyOuter}
          stroke={outline}
          strokeWidth="2"
        />
        {/* Inner Center Pumpkin Rib (2D Flat Layer) */}
        <ellipse
          cx="22"
          cy="23.8"
          rx="9.5"
          ry="12.5"
          fill={bodyCenter}
        />
        {/* Cute Chibi Triangle/Arch Eyes */}
        <path d="M13.5 22.5 L16.8 18 L19.8 22.5 Z" fill={faceFill} />
        <path d="M24.2 22.5 L27.2 18 L30.5 22.5 Z" fill={faceFill} />
        {/* Tiny Cute Cheeks */}
        <circle cx="12.2" cy="25" r="1.7" fill={cheekFill} opacity="0.85" />
        <circle cx="31.8" cy="25" r="1.7" fill={cheekFill} opacity="0.85" />
        {/* Happy Toothy Jack-o'-Lantern Smile */}
        <path
          d="M15 27.2 Q22 32.8 29 27.2 L26.5 27.2 L25.5 28.8 L23.5 27.2 L20.5 27.2 L18.5 28.8 L17.5 27.2 Z"
          fill={faceFill}
        />
      </svg>
    );
  }

  if (type === 'paper') {
    // BÉ MA CHIBI (HỆ LÁ / PAPER)
    const sheetFill = isP1 ? '#fed7aa' : '#e9d5ff';
    const sheetShade = isP1 ? '#fdba74' : '#d8b4fe';
    const outline = isP1 ? '#f97316' : '#a855f7';
    const eyeFill = isP1 ? '#431407' : '#2e1065';
    const cheekFill = isP1 ? '#fb7185' : '#f472b6';

    return (
      <svg viewBox="0 0 44 44" className={className} aria-hidden="true">
        {/* Cute Wavy Sheet Ghost Silhouette with Little Arms */}
        <path
          d="M22 6 C13.5 6 8.5 12 8.5 20 C6 21 5 23.5 7 25.2 C8.2 26 9 25.8 9.5 25.5 L9.5 34.5 C9.5 36.8 12.2 37.5 14 35.4 C15.6 33.6 17.4 33.6 19 35.4 C20.8 37.4 23.2 37.4 25 35.4 C26.6 33.6 28.4 33.6 30 35.4 C31.8 37.5 34.5 36.8 34.5 34.5 L34.5 25.5 C35 25.8 35.8 26 37 25.2 C39 23.5 38 21 35.5 20 C35.5 12 30.5 6 22 6 Z"
          fill={sheetFill}
          stroke={outline}
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        {/* Subtle 2D Bottom Fold Highlight */}
        <path
          d="M12 31 C15 33 29 33 32 31"
          fill="none"
          stroke={sheetShade}
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Big Kawaii Oval Eyes + Shine */}
        <ellipse cx="17.5" cy="19.5" rx="2.3" ry="3" fill={eyeFill} />
        <circle cx="16.8" cy="18.3" r="0.9" fill="#ffffff" />
        <ellipse cx="26.5" cy="19.5" rx="2.3" ry="3" fill={eyeFill} />
        <circle cx="25.8" cy="18.3" r="0.9" fill="#ffffff" />
        {/* Rosy Cheeks */}
        <ellipse cx="13.5" cy="22.5" rx="2" ry="1.2" fill={cheekFill} opacity="0.75" />
        <ellipse cx="30.5" cy="22.5" rx="2" ry="1.2" fill={cheekFill} opacity="0.75" />
        {/* Cute Happy Smile */}
        <path
          d="M19.8 22.8 Q22 25.2 24.2 22.8"
          fill="none"
          stroke={eyeFill}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  // DƠI NHỎ CHIBI (HỆ KÉO / SCISSORS)
  const wingFill = isP1 ? '#ea580c' : '#7e22ce';
  const bodyFill = isP1 ? '#fb923c' : '#c084fc';
  const earInner = isP1 ? '#fed7aa' : '#f3e8ff';
  const outline = isP1 ? '#fff7ed' : '#faf5ff';
  const eyeBg = '#1a0b2e';
  const eyeIris = isP1 ? '#fef08a' : '#67e8f9';

  return (
    <svg viewBox="0 0 44 44" className={className} aria-hidden="true">
      {/* Left & Right Scalloped Chibi Bat Wings */}
      <path
        d="M15 21 C9.5 14 4 15.5 2.5 22.5 C5.8 21.5 7.8 23 8.5 26 C10.8 24.2 12.8 25 14.5 27.5 Z"
        fill={wingFill}
        stroke={outline}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M29 21 C34.5 14 40 15.5 41.5 22.5 C38.2 21.5 36.2 23 35.5 26 C33.2 24.2 31.2 25 29.5 27.5 Z"
        fill={wingFill}
        stroke={outline}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Perky Pointed Bat Ears */}
      <path
        d="M14.5 16 L12.5 7 L19.5 13 Z"
        fill={bodyFill}
        stroke={outline}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M29.5 16 L31.5 7 L24.5 13 Z"
        fill={bodyFill}
        stroke={outline}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M14.8 14.5 L13.8 9.6 L17.8 13 Z" fill={earInner} />
      <path d="M29.2 14.5 L30.2 9.6 L26.2 13 Z" fill={earInner} />

      {/* Chubby Round Bat Body/Head */}
      <circle
        cx="22"
        cy="23"
        r="9.8"
        fill={bodyFill}
        stroke={outline}
        strokeWidth="2"
      />
      {/* Cute Bright Eyes */}
      <circle cx="18.3" cy="21.5" r="2.2" fill={eyeBg} />
      <circle cx="18.3" cy="21.5" r="1.2" fill={eyeIris} />
      <circle cx="25.7" cy="21.5" r="2.2" fill={eyeBg} />
      <circle cx="25.7" cy="21.5" r="1.2" fill={eyeIris} />
      {/* Tiny Smile + Cute White Fangs */}
      <path
        d="M18.8 25.5 Q22 27.3 25.2 25.5"
        fill="none"
        stroke={eyeBg}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M19.5 25.8 L20.4 28.2 L21.2 26.1 Z" fill="#ffffff" />
      <path d="M24.5 25.8 L23.6 28.2 L22.8 26.1 Z" fill="#ffffff" />
    </svg>
  );
};

export const HalloweenShrineGlyph: React.FC<{ kind: 'a1' | 'i9'; isMini?: boolean }> = ({
  kind,
  isMini = false,
}) => {
  const isA1 = kind === 'a1';
  const color = isA1 ? '#fb923c' : '#c084fc';
  return (
    <div className="flex flex-col items-center justify-center pointer-events-none">
      <svg
        viewBox="0 0 28 28"
        className={isMini ? 'w-3.5 h-3.5' : 'w-5 h-5'}
        aria-hidden="true"
      >
        <polygon
          points="14,2 17.5,10 26,14 17.5,18 14,26 10.5,18 2,14 10.5,10"
          fill={color}
          fillOpacity="0.3"
          stroke={color}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="14" cy="14" r="2.5" fill={color} />
      </svg>
      {!isMini && (
        <span className="text-[9px] font-mono font-bold text-[var(--text-primary)] opacity-85 leading-none mt-0.5">
          {kind}
        </span>
      )}
    </div>
  );
};

export const HalloweenObstacleGlyph: React.FC<{ isMini?: boolean }> = ({ isMini = false }) => {
  return (
    <svg
      viewBox="0 0 28 28"
      className={isMini ? 'w-3.5 h-3.5' : 'w-5 h-5'}
      aria-hidden="true"
    >
      <path
        d="M7 23 V12 A7 7 0 0 1 21 12 V23 Z"
        fill="#2a1f3d"
        stroke="#8477a1"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14 9.5 V15.5 M11.5 12 H16.5"
        stroke="#a89ec0"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line x1="5" y1="23" x2="23" y2="23" stroke="#8477a1" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
};

/**
 * Compact inline piece counter with 2D chibi mascot icons for Player 1 & Player 2 HUDs
 */
export const MascotCountsInline: React.FC<{
  counts: { rock: number; paper: number; scissors: number };
  team: 1 | 2;
  compact?: boolean;
}> = ({ counts, team, compact = false }) => {
  const iconSize = compact ? 'w-4 h-4' : 'w-[18px] h-[18px]';
  return (
    <div className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
      <span
        className="inline-flex items-center gap-1"
        title="Bí Ngô (Hệ Đấm) — Ăn Dơi (Kéo), thua Bé Ma (Lá)"
      >
        <HalloweenMascotPiece type="rock" team={team} className={`${iconSize} shrink-0`} />
        <span>{compact ? counts.rock : `Bí Ngô ${counts.rock}`}</span>
      </span>
      <span aria-hidden="true" className="text-[var(--text-muted)]">
        ·
      </span>
      <span
        className="inline-flex items-center gap-1"
        title="Bé Ma (Hệ Lá) — Ăn Bí Ngô (Đấm), thua Dơi (Kéo)"
      >
        <HalloweenMascotPiece type="paper" team={team} className={`${iconSize} shrink-0`} />
        <span>{compact ? counts.paper : `Bé Ma ${counts.paper}`}</span>
      </span>
      <span aria-hidden="true" className="text-[var(--text-muted)]">
        ·
      </span>
      <span
        className="inline-flex items-center gap-1"
        title="Dơi (Hệ Kéo) — Ăn Bé Ma (Lá), thua Bí Ngô (Đấm)"
      >
        <HalloweenMascotPiece type="scissors" team={team} className={`${iconSize} shrink-0`} />
        <span>{compact ? counts.scissors : `Dơi ${counts.scissors}`}</span>
      </span>
    </div>
  );
};

/**
 * Clear Visual Legend explaining the 3 Cute Halloween 2D Mascots, RPS Counter Cycle & Special Cells
 */
export const MascotRulesLegend: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  return (
    <div
      className={`rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] ${
        compact ? 'px-3 py-2.5 text-[11px]' : 'px-4 py-3 text-xs'
      } space-y-2`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-[var(--text-primary)]">
          Chú thích Quân Cờ 2D & Vòng Khắc Chế:
        </span>
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
          <span className="font-semibold text-[#fb923c]">Phe 1: Cam</span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-[#c084fc]">Phe 2: Tím</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center sm:justify-between gap-2 pt-0.5 text-[var(--text-secondary)]">
        <div className="inline-flex items-center gap-1.5">
          <HalloweenMascotPiece type="rock" team={1} className="w-6 h-6 shrink-0" />
          <span>
            <strong className="text-[var(--text-primary)]">Bí Ngô</strong> (Đấm)
          </span>
        </div>

        <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 font-medium">
          ăn
          <ArrowRight className="w-3 h-3" />
        </span>

        <div className="inline-flex items-center gap-1.5">
          <HalloweenMascotPiece type="scissors" team={2} className="w-6 h-6 shrink-0" />
          <span>
            <strong className="text-[var(--text-primary)]">Dơi</strong> (Kéo)
          </span>
        </div>

        <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 font-medium">
          ăn
          <ArrowRight className="w-3 h-3" />
        </span>

        <div className="inline-flex items-center gap-1.5">
          <HalloweenMascotPiece type="paper" team={1} className="w-6 h-6 shrink-0" />
          <span>
            <strong className="text-[var(--text-primary)]">Bé Ma</strong> (Lá)
          </span>
        </div>

        <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 font-medium">
          ăn
          <ArrowRight className="w-3 h-3" />
        </span>

        <div className="inline-flex items-center gap-1.5">
          <HalloweenMascotPiece type="rock" team={2} className="w-5 h-5 shrink-0" />
          <span className="text-[11px]">Bí Ngô</span>
        </div>
      </div>

      {!compact && (
        <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <HalloweenShrineGlyph kind="a1" isMini />
            <span>Ô đích a1 / i9: Đưa quân vào thắng ngay</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <HalloweenObstacleGlyph isMini />
            <span>Bia đá: Ô vật cản không thể đi vào</span>
          </span>
        </div>
      )}
    </div>
  );
};

