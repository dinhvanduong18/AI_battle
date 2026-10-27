import React, { useEffect } from 'react';
import { Music2, Settings, Type, Volume2, VolumeX, X } from 'lucide-react';

export type AppFont = 'jakarta' | 'outfit' | 'system';

interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  font: AppFont;
  onFontChange: (font: AppFont) => void;
  musicEnabled: boolean;
  onMusicEnabledChange: (enabled: boolean) => void | Promise<void>;
  musicError: string | null;
  musicVolume: number;
  onMusicVolumeChange: (volume: number) => void;
  soundEnabled: boolean;
  onSoundEnabledChange: (enabled: boolean) => void;
  soundVolume: number;
  onSoundVolumeChange: (volume: number) => void;
}

export const AppSettingsModal: React.FC<AppSettingsModalProps> = ({
  open,
  onClose,
  font,
  onFontChange,
  musicEnabled,
  onMusicEnabledChange,
  musicError,
  musicVolume,
  onMusicVolumeChange,
  soundEnabled,
  onSoundEnabledChange,
  soundVolume,
  onSoundVolumeChange,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-start bg-black/70 p-4 backdrop-blur-sm sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[#161024] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-5 flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
          <div className="flex items-center gap-2.5">
            <Settings className="h-5 w-5 text-[var(--accent-primary)]" />
            <h2 id="app-settings-title" className="text-lg font-bold text-[var(--text-primary)]">
              Cài đặt
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cài đặt"
            className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-5">
          <label className="block space-y-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Type className="h-4 w-4 text-[var(--accent-primary)]" />
              Font chữ
            </span>
            <select
              value={font}
              onChange={(event) => onFontChange(event.target.value as AppFont)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
            >
              <option value="jakarta">Plus Jakarta Sans</option>
              <option value="outfit">Outfit</option>
              <option value="system">System mặc định</option>
            </select>
          </label>

          <AudioSetting
            icon={<Music2 className="h-4 w-4 text-[var(--accent-primary)]" />}
            label="Nhạc nền"
            enabled={musicEnabled}
            volume={musicVolume}
            onEnabledChange={onMusicEnabledChange}
            onVolumeChange={onMusicVolumeChange}
          />
          {musicError && (
            <p role="alert" className="text-xs leading-relaxed text-red-300">
              {musicError}
            </p>
          )}
          <AudioSetting
            icon={<Volume2 className="h-4 w-4 text-[var(--accent-primary)]" />}
            label="Hiệu ứng âm thanh"
            enabled={soundEnabled}
            volume={soundVolume}
            onEnabledChange={onSoundEnabledChange}
            onVolumeChange={onSoundVolumeChange}
          />
        </div>
      </section>
    </div>
  );
};

interface AudioSettingProps {
  icon: React.ReactNode;
  label: string;
  enabled: boolean;
  volume: number;
  onEnabledChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
}

const AudioSetting: React.FC<AudioSettingProps> = ({
  icon,
  label,
  enabled,
  volume,
  onEnabledChange,
  onVolumeChange,
}) => (
  <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        {icon}
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onEnabledChange(!enabled)}
        className="relative h-6 w-11 shrink-0 rounded-full"
        style={{ backgroundColor: enabled ? 'var(--accent-primary)' : '#475569' }}
      >
        <span
          className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white"
          style={{ transform: `translateX(${enabled ? 20 : 0}px)` }}
        />
        <span className="sr-only">{enabled ? 'Bật' : 'Tắt'} {label}</span>
      </button>
    </div>
    <label className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
      {enabled ? <Volume2 className="h-4 w-4 shrink-0" /> : <VolumeX className="h-4 w-4 shrink-0" />}
      <span className="w-12 shrink-0">Âm lượng</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        onChange={(event) => onVolumeChange(Number(event.target.value))}
        aria-label={`Âm lượng ${label}`}
        className="min-w-0 flex-1 accent-orange-500"
      />
      <span className="w-9 text-right tabular-nums">{Math.round(volume * 100)}%</span>
    </label>
  </div>
);
