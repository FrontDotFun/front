import { type FC, useState } from 'react';
import * as api from '../lib/api';

const PROTOCOL_WALLET = '2uNqHvi3RrkFaFmtBM2KT9eWBDEqoj2eomL97A2v9hoM';

const stepStyle = {
  background: 'var(--bg-2)',
  borderRadius: 'var(--radius-lg)',
  padding: '20px 24px',
  border: '1px solid var(--border)',
} as const;

const numStyle = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: 'var(--gold)',
  color: '#000',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.78rem',
  fontWeight: 700,
  flexShrink: 0,
} as const;

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--bg-1)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-0)',
  fontSize: '0.9rem',
  fontFamily: 'inherit',
  outline: 'none',
} as const;

type Tier = 'bonded' | 'rising' | 'degen';

const tierOptions: { value: Tier; label: string; desc: string; color: string }[] = [
  { value: 'bonded', label: 'Bonded', desc: 'Bonded on Raydium, max 7x leverage', color: '#00c853' },
  { value: 'rising', label: 'Rising', desc: 'High momentum, max 5x leverage', color: '#f0b90b' },
  { value: 'degen', label: 'Degen', desc: 'Early stage, max 3x leverage', color: '#ff3b3b' },
];

export const ListToken: FC = () => {
  const [tokenAddress, setTokenAddress] = useState('');
  const [tier, setTier] = useState<Tier>('degen');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(PROTOCOL_WALLET);
    } catch {
      // clipboard unavailable
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = tokenAddress.trim();
    if (!addr || addr.length < 32) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await api.listToken(addr, tier, name.trim() || undefined, symbol.trim() || undefined);
      setResult({ success: true, message: res.message || 'Token listed successfully' });
      setTokenAddress('');
      setName('');
      setSymbol('');
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to list token',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fade-in" style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>List Your Token</h2>
        <p className="text-muted" style={{ fontSize: '0.93rem', margin: 0 }}>
          List your Pump.fun token on Front to enable leveraged trading.
        </p>
      </div>

      {/* Protocol Wallet */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Protocol Wallet — Redirect Creator Rewards Here
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
          <code className="mono" style={{ fontSize: '0.86rem', color: 'var(--text-0)', flex: 1, wordBreak: 'break-all' }}>
            {PROTOCOL_WALLET}
          </code>
          <button className="btn btn-outline btn-sm" onClick={handleCopy} type="button">
            Copy
          </button>
        </div>
      </div>

      {/* Listing Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-1)', marginBottom: 6, display: 'block' }}>
            Token Contract Address
          </label>
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            placeholder="Paste Solana token address..."
            style={inputStyle}
            required
          />
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '0.82rem', color: 'var(--text-1)', marginBottom: 6, display: 'block' }}>
              Name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Token name"
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '0.82rem', color: 'var(--text-1)', marginBottom: 6, display: 'block' }}>
              Symbol (optional)
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. POPCAT"
              style={inputStyle}
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-1)', marginBottom: 8, display: 'block' }}>
            Tier
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {tierOptions.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTier(t.value)}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: tier === t.value ? `${t.color}15` : 'var(--bg-1)',
                  border: `1px solid ${tier === t.value ? t.color : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: '0.86rem', fontWeight: 600, color: t.color }}>{t.label}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-1)', marginTop: 2 }}>{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || tokenAddress.trim().length < 32}
          style={{
            padding: '12px 0',
            fontSize: '0.93rem',
            fontWeight: 600,
            background: 'var(--gold)',
            color: '#000',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Listing...' : 'List Token'}
        </button>

        {result && (
          <div style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: result.success ? 'rgba(0, 200, 83, 0.08)' : 'rgba(255, 59, 59, 0.08)',
            border: `1px solid ${result.success ? '#00c853' : '#ff3b3b'}`,
            color: result.success ? '#00c853' : '#ff3b3b',
            fontSize: '0.86rem',
          }}>
            {result.message}
          </div>
        )}
      </form>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[
          { title: 'Redirect Creator Rewards', desc: 'On Pump.fun, redirect your token\'s creator rewards to the Front Protocol wallet above. This funds the capital pool for leveraged trading.' },
          { title: 'Submit Your Token', desc: 'Paste your token contract address above and select the tier. The protocol verifies the token on-chain.' },
          { title: 'Live on Front', desc: 'Your token appears on the trading page. Traders can take leveraged positions, driving volume and attention.' },
        ].map((step, i) => (
          <div key={i} style={stepStyle}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={numStyle}>{i + 1}</div>
              <div>
                <h4 style={{ margin: '0 0 6px', fontSize: '0.93rem' }}>{step.title}</h4>
                <p className="text-muted" style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.6 }}>
                  {step.desc}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
