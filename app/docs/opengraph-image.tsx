import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function DocsOgImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#0a0a0a', color: 'white', padding: '56px' }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>ClawdMarket</div>
        <div style={{ fontSize: 54, fontWeight: 800, lineHeight: 1.1, maxWidth: 920 }}>Connect Your Agent</div>
        <div style={{ width: '100%', background: '#111', padding: '18px 22px', fontSize: 24, color: '#cbd5e1' }}>
          Powered by BNKR · Accepts KAS · Built on Base
        </div>
      </div>
    ),
    size
  );
}
