import React, { useState, useEffect } from 'react';
import { Wrench, Clock, ShieldAlert, RefreshCw, KeyRound, CheckCircle2, Sparkles, Unlock } from 'lucide-react';

interface MaintenanceOverlayProps {
  onBypass?: () => void;
  backendUrl?: string;
}

export const MaintenanceOverlay: React.FC<MaintenanceOverlayProps> = ({ onBypass }) => {
  const [timeLeft, setTimeLeft] = useState<{ hours: number; minutes: number; seconds: number }>({
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [showAdminBypass, setShowAdminBypass] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [passError, setPassError] = useState(false);
  const [checking, setChecking] = useState(false);

  // Tính toán thời gian còn lại đến 06:00 Sáng (Giờ Việt Nam GMT+7)
  const calculateTimeRemaining = () => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const vnNow = new Date(utc + 7 * 3600000);

    const target = new Date(vnNow);
    const hour = vnNow.getHours();
    if (hour >= 23) {
      target.setDate(target.getDate() + 1);
    }
    target.setHours(6, 0, 0, 0);

    const diffMs = Math.max(0, target.getTime() - vnNow.getTime());
    const totalSecs = Math.floor(diffMs / 1000);

    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    return { hours, minutes, seconds };
  };

  useEffect(() => {
    setTimeLeft(calculateTimeRemaining());
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeRemaining());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleBypassSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode.trim() === 'ott-admin-2026') {
      localStorage.setItem('ott_bypass_maintenance', 'ott-admin-2026');
      if (onBypass) onBypass();
    } else {
      setPassError(true);
      setTimeout(() => setPassError(false), 2500);
    }
  };

  const handleCheckStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/maintenance');
      const data = await res.json();
      if (!data.isMaintenance) {
        window.location.reload();
      }
    } catch {}
    setTimeout(() => setChecking(false), 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xl animate-fade-in select-none">
      {/* Background Glow Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Card */}
      <div className="relative w-full max-w-xl p-8 text-center rounded-3xl border border-amber-500/20 bg-gradient-to-b from-slate-900/90 to-slate-950/95 shadow-2xl shadow-amber-950/30 overflow-hidden">
        {/* Top Decorative Stripe */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600" />

        {/* Floating Icon with Glowing Pulse */}
        <div className="relative inline-flex items-center justify-center mb-6">
          <div className="absolute inset-0 rounded-full bg-amber-500/20 blur-xl animate-pulse" />
          <div className="relative flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 shadow-inner">
            <Wrench className="w-10 h-10 text-amber-400 animate-bounce duration-1000" />
            <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-yellow-300 animate-spin duration-3000" />
          </div>
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 mb-4 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-semibold uppercase tracking-wider">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>Khung Giờ Bảo Trì: 23:00 — 06:00 (GMT+7)</span>
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-3">
          HỆ THỐNG ĐANG BẢO TRÌ NÂNG CẤP
        </h1>

        {/* Description */}
        <p className="text-sm sm:text-base text-slate-300/90 leading-relaxed mb-6 max-w-lg mx-auto">
          Đấu trường AI Battle đang tạm khóa các cổng kết nối để tối ưu hóa hiệu năng máy chủ, dọn dẹp cơ sở dữ liệu và chuẩn bị cho các giải đấu tiếp theo.
        </p>

        {/* Countdown Box */}
        <div className="p-4 mb-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-inner">
          <div className="flex items-center justify-center gap-2 mb-2 text-xs font-medium text-slate-400 uppercase tracking-widest">
            <Clock className="w-4 h-4 text-amber-400" />
            <span>Thời gian dự kiến mở lại lúc 06:00 Sáng</span>
          </div>

          <div className="flex items-center justify-center gap-3 text-center">
            <div className="flex flex-col items-center">
              <span className="text-3xl sm:text-4xl font-mono font-black text-amber-400 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-amber-500/20 min-w-[3.5rem]">
                {String(timeLeft.hours).padStart(2, '0')}
              </span>
              <span className="text-[10px] text-slate-400 mt-1 font-semibold uppercase">Giờ</span>
            </div>
            <span className="text-2xl font-bold text-amber-500/60 -mt-4">:</span>
            <div className="flex flex-col items-center">
              <span className="text-3xl sm:text-4xl font-mono font-black text-amber-400 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-amber-500/20 min-w-[3.5rem]">
                {String(timeLeft.minutes).padStart(2, '0')}
              </span>
              <span className="text-[10px] text-slate-400 mt-1 font-semibold uppercase">Phút</span>
            </div>
            <span className="text-2xl font-bold text-amber-500/60 -mt-4">:</span>
            <div className="flex flex-col items-center">
              <span className="text-3xl sm:text-4xl font-mono font-black text-amber-400 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-amber-500/20 min-w-[3.5rem]">
                {String(timeLeft.seconds).padStart(2, '0')}
              </span>
              <span className="text-[10px] text-slate-400 mt-1 font-semibold uppercase">Giây</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={handleCheckStatus}
            disabled={checking}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-slate-200 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            <span>{checking ? 'Đang kiểm tra...' : 'Kiểm tra trạng thái'}</span>
          </button>

          <button
            onClick={() => setShowAdminBypass(!showAdminBypass)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-medium text-slate-400 hover:text-amber-300 transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Dành cho Quản trị viên</span>
          </button>
        </div>

        {/* Admin Bypass Modal Drawer */}
        {showAdminBypass && (
          <form
            onSubmit={handleBypassSubmit}
            className="mt-6 pt-5 border-t border-slate-800 text-left animate-slide-down"
          >
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Nhập mã xác thực Admin để mở khóa kiểm thử:
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Nhập mã bí mật..."
                className={`flex-1 px-3.5 py-2 rounded-xl text-sm bg-slate-950 border ${
                  passError ? 'border-red-500 text-red-300' : 'border-slate-700 text-white'
                } focus:outline-none focus:border-amber-400`}
                autoFocus
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-slate-900 bg-amber-400 hover:bg-amber-300 transition-colors"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Mở khóa</span>
              </button>
            </div>
            {passError && (
              <p className="text-[11px] text-red-400 mt-1.5">Mã bảo vệ không chính xác.</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
