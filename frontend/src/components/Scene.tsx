// Frosted glass requires visual background elements to blur: gradient wall, line art, two-color lighting, and glowing blobs.
export function Scene() {
  return (
    <div className="scene" aria-hidden="true">
      <div className="wall" />
      <svg className="absolute inset-0 w-full h-full opacity-[0.22] pointer-events-none" viewBox="0 0 1440 900" fill="none" preserveAspectRatio="xMidYMid slice">
        <path d="M-100 850 C300 680 600 800 1000 480 C1300 200 1500 380 1600 -80" stroke="url(#bg-grad-1)" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M150 950 C450 580 750 850 1150 380" stroke="url(#bg-grad-2)" strokeWidth="2.5" strokeDasharray="10 10" />
        <circle cx="85%" cy="15%" r="280" stroke="url(#bg-grad-3)" strokeWidth="1.8" />
        <circle cx="85%" cy="15%" r="180" stroke="url(#bg-grad-3)" strokeWidth="1.2" />
        <circle cx="20%" cy="80%" r="350" stroke="url(#bg-grad-1)" strokeWidth="1.8" />
        <circle cx="20%" cy="80%" r="220" stroke="url(#bg-grad-1)" strokeWidth="1.2" strokeDasharray="6 6" />
        <path d="M500 -50 C700 200 600 400 900 600" stroke="url(#bg-grad-2)" strokeWidth="1.5" />
        <defs>
          <linearGradient id="bg-grad-1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#B57004" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="bg-grad-2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#B57004" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="bg-grad-3" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#B57004" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.1" />
          </linearGradient>
        </defs>
      </svg>
      <div className="lamp-light" />
      <div className="blob blob-bronze" />
      <div className="blob blob-cyan" />
      <div className="floor-shadow" />
    </div>
  );
}
