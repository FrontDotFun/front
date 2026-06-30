import { type FC, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { formatUsd } from '../lib/format';

export const Explore: FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [trending, setTrending] = useState<api.MarketToken[]>([]);
  const [searchResults, setSearchResults] = useState<api.MarketToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  // Load trending on mount
  useEffect(() => {
    api.getMarketTrending()
      .then((data) => setTrending(data))
      .catch(() => setTrending([]))
      .finally(() => setLoading(false));
  }, []);

  // Debounced search
  useEffect(() => {
    if (!search.trim() || search.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api.searchMarket(search)
        .then((data) => setSearchResults(data))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const displayTokens = search.trim().length >= 2 ? searchResults : trending;

  const handleTokenClick = (token: api.MarketToken) => {
    navigate(`/trade?token=${token.address}&name=${token.name}&symbol=${token.symbol}`);
  };

  const formatChange = (pct: number) => {
    const color = pct >= 0 ? '#22c55e' : '#ef4444';
    const sign = pct >= 0 ? '+' : '';
    return <span style={{ color, fontWeight: 600 }}>{sign}{pct.toFixed(1)}%</span>;
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Explore Tokens</h2>
          <p style={{ fontSize: '0.86rem', color: '#666' }}>
            Discover trending Solana tokens — click any token to start trading with leverage
          </p>
        </div>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="search-wrapper" style={{ flex: 1, maxWidth: 500 }}>
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search-input"
            placeholder="Search by name, symbol, or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {searching && <span style={{ fontSize: 12, color: '#666' }}>Searching...</span>}
      </div>

      {/* Token Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="skeleton" style={{ height: 160, borderRadius: 14 }} />
          ))}
        </div>
      ) : displayTokens.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">
            {search ? 'No tokens found' : 'Loading trending tokens...'}
          </div>
          <div className="empty-state-text">
            {search ? 'Try a different search term' : 'Check back in a moment'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {displayTokens.map((token) => (
            <div
              key={token.address}
              className="token-card"
              onClick={() => handleTokenClick(token)}
              style={{
                background: '#0a0a0a',
                border: '1px solid #1a1a1a',
                borderRadius: 14,
                padding: '16px 18px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#f0b90b30';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#1a1a1a';
                e.currentTarget.style.transform = 'none';
              }}
            >
              {/* Token Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                {token.logoURI ? (
                  <img
                    src={token.logoURI}
                    alt={token.symbol}
                    style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #f0b90b20, #f0b90b05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: '#f0b90b',
                  }}>
                    {token.symbol?.charAt(0) || '?'}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{token.symbol}</div>
                  <div style={{ fontSize: 11, color: '#666', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {token.name}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>
                    ${token.price < 0.01 ? token.price.toExponential(2) : token.price.toFixed(4)}
                  </div>
                  <div style={{ fontSize: 11 }}>
                    {formatChange(token.priceChange24h)}
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
                paddingTop: 12, borderTop: '1px solid #111',
              }}>
                <div>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>Market Cap</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#ccc', fontFamily: "'JetBrains Mono', monospace" }}>
                    {formatUsd(token.marketCap)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>24h Volume</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#ccc', fontFamily: "'JetBrains Mono', monospace" }}>
                    {formatUsd(token.volume24h)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>Liquidity</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#ccc', fontFamily: "'JetBrains Mono', monospace" }}>
                    {formatUsd(token.liquidity)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
