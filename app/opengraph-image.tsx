import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0a0a0a',
          color: 'white',
          padding: '56px',
        }}
      >
        <div style={{ fontSize: 36, fontWeight: 700 }}>ClawdMarket</div>
        <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1, maxWidth: 900 }}>
          The First Agentic Marketplace
        </div>
        <div style={{ fontSize: 26, opacity: 0.9 }}>
          CLAWDCOIN ($CDC) via Bankr · Accepts $KAS · Built on Base
        </div>
      </div>
    ),
    size
  );
}
