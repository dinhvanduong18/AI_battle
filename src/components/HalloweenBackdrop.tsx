import React, { useState } from 'react';
import castlePumpkinsBg from '../assets/images/halloween_castle_pumpkins_bg_1792817506446.jpg';

const FIREFLIES = [
  { cls: 'ff-1 firefly-amber' },
  { cls: 'ff-2 firefly-amber' },
  { cls: 'ff-3 firefly-amber' },
  { cls: 'ff-4 firefly-violet' },
  { cls: 'ff-5 firefly-amber' },
  { cls: 'ff-6 firefly-violet' },
  { cls: 'ff-7 firefly-amber' },
  { cls: 'ff-8 firefly-amber' },
  { cls: 'ff-9 firefly-amber' },
  { cls: 'ff-10 firefly-violet' },
  { cls: 'ff-11 firefly-amber' },
  { cls: 'ff-12 firefly-amber' },
];

export const HalloweenBackdrop: React.FC = () => {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden select-none bg-gradient-to-b from-[#130c24] via-[#0c0817] to-[#080510]"
    >
      {/* Dark Fantasy Castle & Pumpkin Lanterns Painting */}
      {!imgFailed && (
        <img
          src={castlePumpkinsBg}
          alt="Lâu đài cổ và con đường đèn bí ngô dưới trăng máu"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover object-center opacity-50 scale-[1.01]"
        />
      )}

      {/* Measured Atmospheric Scrim for High-Contrast UI Readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#090611]/65 via-[#0c0818]/55 to-[#08050f]/80" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(249,115,22,0.08),transparent_60%)]" />

      {/* Gently Drifting Fireflies */}
      <div className="absolute inset-0">
        {FIREFLIES.map((mote, idx) => (
          <span key={idx} className={`firefly-mote ${mote.cls}`} />
        ))}
      </div>
    </div>
  );
};
