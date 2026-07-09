import { type FC, type ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Scramble } from '../components/fx/Scramble';
import * as api from '../lib/api';

/* ═══════════════════════════════════════════════════════════════
   FRONT — PHOSPHOR landing experience
   POST boot · live market wall · risk computer · spec plates
   ═══════════════════════════════════════════════════════════════ */

const FRONT_CA = 'f2LZJzFYi1DScywiKUanLpMuWoDKSgqvink82sxpump';

/* ── Boot / POST sequence ───────────────────────────────────── */
const BOOT_LINES: Array<{ text: string; status?: string }> = [
  { text: 'FRONT TERMINAL BIOS v2.0.7 — PHOSPHOR' },
  { text: 'MEM CHECK ................ 640K DEGEN RAM', status: 'OK' },
  { text: 'SOLANA MAINNET LINK ......', status: 'OK' },
  { text: 'LENDING POOL .............', status: 'ARMED' },
  { text: 'LIQUIDATION ENGINE .......', status: 'HOT' },
  { text: 'JUPITER ROUTER ...........', status: 'OK' },
  { text: 'MERCY MODULE .............', status: 'NOT FOUND' },
];

const BootIntro: FC<{ onDone: () => void }> = ({ onDone }) => {
  const [count, setCount] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const finish = useCallback(() => {
    setLeaving(true);
    setTimeout(onDone, 350);
  }, [onDone]);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= BOOT_LINES.length) {
        clearInterval(t);
        setTimeout(finish, 650);
      }
    }, 190);
    const key = () => finish();
    window.addEventListener('keydown', key);
    return () => { clearInterval(t); window.removeEventListener('keydown', key); };
  }, [finish]);

  return (
    <div className={`boot-overlay ${leaving ? 'boot-leaving' : ''}`} onClick={finish}>
      <div className="boot-box">
        {BOOT_LINES.slice(0, count).map((l, idx) => (
          <div key={idx} className="boot-line">
            <span>{l.text}</span>
            {l.status && (
              <span className={`boot-status ${l.status === 'NOT FOUND' ? 'boot-status-warn' : ''}`}>
                [{l.status}]
              </span>
            )}
          </div>
        ))}
        <div className="boot-cursor" />
      </div>
      <div className="boot-skip blink">PRESS ANY KEY TO SKIP</div>
    </div>
  );
};

/* ── Market wall — self-drawing phosphor candle chart ───────── */
const MarketWall: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = canvas.offsetWidth;
      h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Synthetic random-walk candles
    interface Candle { o: number; c: number; hi: number; lo: number }
    const candles: Candle[] = [];
    let price = 0.5;
    const step = () => {
      const drift = (Math.random() - 0.47) * 0.06;
      const o = price;
      const c = Math.min(0.95, Math.max(0.05, price + drift));
      const hi = Math.max(o, c) + Math.random() * 0.02;
      const lo = Math.min(o, c) - Math.random() * 0.02;
      price = c;
      candles.push({ o, c, hi, lo });
      if (candles.length > 90) candles.shift();
    };
    for (let i = 0; i < 90; i++) step();

    const mouse = { x: -9999, y: -9999 };
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseout', onLeave);

    let raf = 0;
    let lastStep = 0;

    const draw = (now: number) => {
      if (now - lastStep > 420) { step(); lastStep = now; }
      ctx.clearRect(0, 0, w, h);

      // Phosphor grid
      ctx.strokeStyle = 'rgba(255, 179, 0, 0.045)';
      ctx.lineWidth = 1;
      const gx = 64;
      for (let x = 0.5; x < w; x += gx) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0.5; y < h; y += gx) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // Candles
      const cw = w / 90;
      const bw = Math.max(2, cw * 0.5);
      candles.forEach((cd, i) => {
        const x = i * cw + cw / 2;
        const up = cd.c >= cd.o;
        const col = up ? 'rgba(61, 255, 158, 0.20)' : 'rgba(255, 77, 77, 0.18)';
        const yO = h - cd.o * h;
        const yC = h - cd.c * h;
        const yHi = h - cd.hi * h;
        const yLo = h - cd.lo * h;
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(x, yHi); ctx.lineTo(x, yLo); ctx.stroke();
        ctx.fillStyle = col;
        ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.max(1.5, Math.abs(yC - yO)));
      });

      // Last-price line
      const lastY = h - candles[candles.length - 1].c * h;
      ctx.strokeStyle = 'rgba(255, 179, 0, 0.28)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(w, lastY); ctx.stroke();
      ctx.setLineDash([]);

      // Cursor crosshair
      if (mouse.x > 0 && mouse.y > 0) {
        ctx.strokeStyle = 'rgba(255, 179, 0, 0.18)';
        ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(mouse.x + 0.5, 0); ctx.lineTo(mouse.x + 0.5, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, mouse.y + 0.5); ctx.lineTo(w, mouse.y + 0.5); ctx.stroke();
        ctx.setLineDash([]);
        const px = (1 - mouse.y / h);
        ctx.fillStyle = 'rgba(255, 179, 0, 0.55)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(`${(px * 100).toFixed(1)}%`, mouse.x + 8, mouse.y - 8);
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="lp-canvas" />;
};

/* ── Typewriter line ────────────────────────────────────────── */
const Typewriter: FC<{ text: string; delay?: number; className?: string }> = ({ text, delay = 0, className = '' }) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setN(text.length); return; }
    let t: ReturnType<typeof setInterval>;
    const d = setTimeout(() => {
      t = setInterval(() => {
        setN((v) => {
          if (v >= text.length) { clearInterval(t); return v; }
          return v + 1;
        });
      }, 14);
    }, delay);
    return () => { clearTimeout(d); clearInterval(t); };
  }, [text, delay]);
  return <p className={className}>{text.slice(0, n)}{n < text.length && <span className="lp-caret">▮</span>}</p>;
};

/* ── Live protocol stat ─────────────────────────────────────── */
const lam = (v?: string) => (v ? Number(v) / 1e9 : 0);

const LiveStats: FC = () => {
  const [stats, setStats] = useState<api.ProtocolStatsResponse | null>(null);

  useEffect(() => {
    api.getProtocolStats().then(setStats).catch(() => {});
  }, []);

  const items = [
    { k: 'MAX LEVERAGE', v: '10.0X' },
    { k: 'FLAT FEE', v: '0.5%' },
    {
      k: 'SOL BURNED',
      v: stats ? `${lam(stats.totalBurnedLamports).toFixed(2)}◎` : '—',
    },
    {
      k: 'TRADES EXECUTED',
      v: stats ? String(stats.totalTradesExecuted).padStart(4, '0') : '—',
    },
    {
      k: 'LISTED TOKENS',
      v: stats ? String(stats.activeListedTokens).padStart(3, '0') : '—',
    },
  ];

  return (
    <div className="lp-stats">
      {items.map((s, i) => (
        <div className="lp-stat" key={s.k}>
          <b className="mono"><Scramble text={s.v} delay={900 + i * 120} speed={36} /></b>
          <span>{s.k}</span>
        </div>
      ))}
    </div>
  );
};

/* ── Risk computer (simulator — exact protocol math) ────────── */
const RiskComputer: FC = () => {
  const [collateral, setCollateral] = useState(1);
  const [leverage, setLeverage] = useState(5);
  const [move, setMove] = useState(25);

  const position = collateral * leverage;
  const borrowed = collateral * (leverage - 1);
  const fee = position * 0.005;
  const liqPct = -(100 / leverage) * 0.85;
  const grossPnl = position * (move / 100);
  const liquidated = move <= liqPct;
  const userPnl = liquidated ? -collateral : grossPnl * 0.7;

  return (
    <div className="pg">
      <div className="pg-head">
        <span className="pg-title">RISK COMPUTER — MODEL RC/83</span>
        <span className="pg-sub">drag everything · this is the exact protocol math</span>
      </div>

      <div className="pg-grid">
        <div className="pg-controls">
          <div className="pg-field">
            <div className="pg-row">
              <span>COLLATERAL</span>
              <span className="pg-val mono">{collateral.toFixed(1)} SOL</span>
            </div>
            <input type="range" min="0.1" max="10" step="0.1" value={collateral}
              onChange={(e) => setCollateral(parseFloat(e.target.value))} className="pg-slider" />
          </div>

          <div className="pg-field">
            <div className="pg-row">
              <span>LEVERAGE</span>
              <span className="pg-val pg-lev mono">{leverage}X</span>
            </div>
            <input type="range" min="2" max="10" step="1" value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))} className="pg-slider" />
          </div>

          <div className="pg-field">
            <div className="pg-row">
              <span>TOKEN MOVES</span>
              <span className="pg-val mono" style={{ color: move >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {move >= 0 ? '+' : ''}{move}%
              </span>
            </div>
            <input type="range" min="-60" max="120" step="1" value={move}
              onChange={(e) => setMove(parseInt(e.target.value))} className="pg-slider pg-slider-move" />
          </div>
        </div>

        <div className="pg-out">
          <div className="pg-bar">
            <motion.div
              className="pg-bar-you"
              animate={{ width: `${(collateral / position) * 100}%` }}
              transition={{ type: 'spring', stiffness: 180, damping: 24 }}
            >YOU</motion.div>
            <motion.div
              className="pg-bar-pool"
              animate={{ width: `${(borrowed / position) * 100}%` }}
              transition={{ type: 'spring', stiffness: 180, damping: 24 }}
            >POOL</motion.div>
          </div>

          <div className="pg-stats">
            <div className="pg-stat">
              <span>POSITION SIZE</span>
              <b className="mono">{position.toFixed(2)} SOL</b>
            </div>
            <div className="pg-stat">
              <span>ENTRY FEE 0.5%</span>
              <b className="mono">{fee.toFixed(3)} SOL</b>
            </div>
            <div className="pg-stat">
              <span>LIQUIDATION AT</span>
              <b className="mono" style={{ color: 'var(--red)' }}>{liqPct.toFixed(1)}%</b>
            </div>
          </div>

          <div className={`pg-result ${liquidated ? 'pg-rekt' : userPnl >= 0 ? 'pg-win' : 'pg-loss'}`}>
            {liquidated ? (
              <>
                <span className="pg-result-label">■ LIQUIDATED ■</span>
                <span className="pg-result-num mono">-{collateral.toFixed(2)} SOL</span>
                <span className="pg-result-sub">position auto-closed · pool stays whole</span>
              </>
            ) : (
              <>
                <span className="pg-result-label">{userPnl >= 0 ? 'YOUR PROFIT (70%)' : 'YOUR PNL'}</span>
                <span className="pg-result-num mono">{userPnl >= 0 ? '+' : ''}{userPnl.toFixed(2)} SOL</span>
                <span className="pg-result-sub">
                  {userPnl >= 0 ? '30% auto-buys $FRONT · locked 7 days' : 'still above liquidation — hold or exit'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Section reveal helper ──────────────────────────────────── */
const Reveal: FC<{ children: ReactNode; delay?: number }> = ({ children, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 26 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-60px' }}
    transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
  >
    {children}
  </motion.div>
);

/* ── Page ───────────────────────────────────────────────────── */
export const Landing: FC = () => {
  const [booted, setBooted] = useState(() => {
    try { return sessionStorage.getItem('front_booted') === '1'; } catch { return true; }
  });

  const onBootDone = useCallback(() => {
    try { sessionStorage.setItem('front_booted', '1'); } catch { /* ignore */ }
    setBooted(true);
  }, []);

  return (
    <div className="lp">
      {!booted && <BootIntro onDone={onBootDone} />}

      {/* Nav */}
      <nav className="lp-nav">
        <div className="lp-logo">
          <img src="/front-logo.png" alt="" width="22" height="22" />
          <span className="lp-logo-text">FRONT_</span>
        </div>
        <div className="lp-nav-links">
          <a href="#sim">SIMULATOR</a>
          <a href="#how">PROCEDURE</a>
          <a href="#tiers">TIERS</a>
          <Link to="/docs">MANUAL</Link>
        </div>
        <Link to="/trade" className="lp-cta-sm">ENTER TERMINAL</Link>
      </nav>

      {/* Hero */}
      <header className="lp-hero">
        <MarketWall />
        <div className="lp-hero-inner">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="lp-badge"
          >
            <span className="lp-badge-dot" /> LIVE ON SOLANA MAINNET — TERMINAL v2.0
          </motion.div>

          <h1 className="lp-h1">
            <Scramble text="LEVERAGE THE" delay={250} speed={34} className="lp-h1-line lp-h1-dim" as="div" />
            <Scramble text="MEMECONOMY" delay={650} speed={44} className="lp-h1-line lp-h1-amber" as="div" />
          </h1>

          <Typewriter
            className="lp-sub"
            delay={1300}
            text="Up to 10x on any Pump.fun token. You post collateral, the pool fronts the rest, everything executes on-chain. No order books. No wallet extension. No mercy."
          />

          <motion.div
            className="lp-cta-row"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.9 }}
          >
            <Link to="/trade" className="lp-cta-main">
              [ START TRADING <span className="lp-cta-arrow">→</span> ]
            </Link>
            <a href="#sim" className="lp-cta-ghost">[ RUN SIMULATOR ]</a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.2 }}
          >
            <LiveStats />
          </motion.div>
        </div>
      </header>

      {/* Tape marquee */}
      <div className="lp-marquee">
        <div className="lp-marquee-track">
          {[0, 1].map((k) => (
            <div className="lp-marquee-seg" key={k} aria-hidden={k === 1}>
              <span>NO CEX</span><i>◆</i><span>PURE ON-CHAIN</span><i>◆</i><span>10X LEVERAGE</span><i>◆</i>
              <span>REAL JUPITER SWAPS</span><i>◆</i><span>CREATORS GET PAID</span><i>◆</i><span>THE POOL NEVER LOSES</span><i>◆</i>
            </div>
          ))}
        </div>
      </div>

      {/* Simulator */}
      <section className="lp-section" id="sim">
        <Reveal>
          <div className="sec-label">SEC.01 — SIMULATION</div>
          <h2 className="lp-h2">FEEL THE <span className="lp-amber">LEVERAGE</span></h2>
          <p className="lp-section-sub">The exact math the protocol runs on every position. No sugar-coating.</p>
        </Reveal>
        <Reveal delay={0.1}><RiskComputer /></Reveal>
      </section>

      {/* Procedure */}
      <section className="lp-section" id="how">
        <Reveal>
          <div className="sec-label">SEC.02 — OPERATING PROCEDURE</div>
          <h2 className="lp-h2">THREE STEPS TO <span className="lp-amber">SEND IT</span></h2>
        </Reveal>
        <div className="lp-steps">
          {[
            { n: '01', t: 'DEPOSIT', d: 'Sign in with email. A custodial Solana wallet is generated — no extension, no seed-phrase anxiety. Fund it with SOL.' },
            { n: '02', t: 'PICK & SIZE', d: 'Choose any listed Pump.fun token. Set collateral and dial leverage 2–10x. The lending pool fronts the rest — instantly.' },
            { n: '03', t: 'RIDE OR DIE', d: 'Position executes as a real Jupiter swap. Take profit, stop loss, or 24h auto-close. Profits split 70/30 with $FRONT buybacks.' },
          ].map((c, i) => (
            <Reveal delay={i * 0.1} key={c.n}>
              <div className="lp-step">
                <span className="lp-step-n mono">{c.n}</span>
                <div className="lp-step-body">
                  <h3 className="lp-step-t"><Scramble text={c.t} hover speed={22} /></h3>
                  <p className="lp-step-d">{c.d}</p>
                </div>
                <span className="lp-step-arrow">→</span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Tiers — spec plate */}
      <section className="lp-section" id="tiers">
        <Reveal>
          <div className="sec-label">SEC.03 — RISK CLASSIFICATION</div>
          <h2 className="lp-h2">RISK <span className="lp-amber">TIERS</span></h2>
          <p className="lp-section-sub">Bigger token, bigger leverage. The protocol prices risk automatically.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="lp-tier-table">
            <div className="lp-tier-row lp-tier-row-head">
              <span>CLASS</span><span>MAX LEV</span><span>LIQ. AT</span><span>DESCRIPTION</span>
            </div>
            {[
              { name: 'BONDED', lev: '10X', liq: '-15%', desc: 'Graduated to Raydium. Deep liquidity, maximum send.', cls: 'lp-tier-bonded' },
              { name: 'RISING', lev: '5X', liq: '-12%', desc: '$100K+ market cap and climbing. Balanced degen.', cls: 'lp-tier-rising' },
              { name: 'DEGEN', lev: '3X', liq: '-10%', desc: 'Fresh off the curve. Tight leash, pure adrenaline.', cls: 'lp-tier-degen' },
            ].map((t) => (
              <div className={`lp-tier-row ${t.cls}`} key={t.name}>
                <span className="lp-tier-name">■ {t.name}</span>
                <span className="lp-tier-lev mono">{t.lev}</span>
                <span className="lp-tier-liq mono">{t.liq}</span>
                <span className="lp-tier-desc">{t.desc}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Flywheel */}
      <section className="lp-section">
        <Reveal>
          <div className="sec-label">SEC.04 — FEE ROUTING</div>
          <h2 className="lp-h2">THE <span className="lp-amber">FLYWHEEL</span></h2>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="lp-fly">
            {[
              { k: '50%', v: 'OF FEES REFILL THE LENDING POOL', c: 'var(--green)' },
              { k: '30%', v: 'PAID TO THE TOKEN CREATOR', c: 'var(--primary)' },
              { k: '20%', v: 'BUYS & BURNS $FRONT', c: 'var(--magenta)' },
            ].map((f) => (
              <div className="lp-fly-item" key={f.k}>
                <span className="lp-fly-k mono" style={{ color: f.c }}>{f.k}</span>
                <span className="lp-fly-v">{f.v}</span>
                <div className="lp-fly-bar">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: f.k }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                    style={{ background: f.c, height: '100%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Final CTA */}
      <section className="lp-final">
        <Reveal>
          <h2 className="lp-final-h">
            <Scramble text="READY TO FRONT?" hover speed={30} />
            <span className="lp-caret blink">▮</span>
          </h2>
          <Link to="/trade" className="lp-cta-main lp-cta-big">
            [ LAUNCH TERMINAL <span className="lp-cta-arrow">→</span> ]
          </Link>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-left">
          <span className="lp-logo-text">FRONT_</span>
          <span className="lp-footer-dim">BUILT FOR DEGENS. THE POOL NEVER LOSES.</span>
          <a
            className="lp-footer-ca mono"
            href={`https://pump.fun/coin/${FRONT_CA}`}
            target="_blank"
            rel="noopener noreferrer"
            title={FRONT_CA}
          >
            CA: {FRONT_CA.slice(0, 6)}…{FRONT_CA.slice(-6)}
          </a>
        </div>
        <div className="lp-footer-links">
          <a href="https://twitter.com/FrontDotFun" target="_blank" rel="noreferrer">TWITTER</a>
          <a href="https://t.me/FrontProtocol" target="_blank" rel="noreferrer">TELEGRAM</a>
          <a href="https://github.com/FrontDotFun/front" target="_blank" rel="noreferrer">GITHUB</a>
          <Link to="/docs">MANUAL</Link>
        </div>
      </footer>
    </div>
  );
};
