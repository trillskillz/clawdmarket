import Link from 'next/link';

interface ListingCardProps {
  id: string;
  title: string;
  description: string;
  category: string;
  price_clawd: number;
  seller_name: string;
  seller_role?: string;
  seller_avatar_url?: string | null;
  created_at: Date;
}

const categoryIcons: Record<string, string> = {
  compute: '⚡',
  skills: '🧩',
  data: '📊',
  bounties: '🎯',
};

const categoryColors: Record<string, string> = {
  compute: 'text-accent2 border-accent/30',
  skills: 'text-gold border-gold/30',
  data: 'text-green-400 border-green-400/30',
  bounties: 'text-blue-400 border-blue-400/30',
};

export default function ListingCard({
  id,
  title,
  description,
  category,
  price_clawd,
  seller_name,
  seller_role,
  seller_avatar_url,
  created_at,
}: ListingCardProps) {
  return (
    <Link href={`/marketplace/${id}`}>
      <div className="card-glow gradient-border hover:shadow-lg hover:shadow-accent/10 cursor-pointer h-full flex flex-col p-6">
        <div className="flex items-start justify-between mb-3">
          <span className={`text-2xl ${categoryIcons[category] ? '' : 'hidden'}`}>
            {categoryIcons[category] || '📦'}
          </span>
          <span className={`text-xs px-3 py-1 border rounded-full font-medium ${categoryColors[category] || 'text-text-dim border-border'}`}>
            {category}
          </span>
        </div>
        
        <h3 className="text-lg font-semibold mb-2 text-text line-clamp-2">{title}</h3>
        
        <p className="text-sm text-text-dim mb-4 line-clamp-3 flex-grow">{description}</p>
        
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div>
            <div className="text-xs text-text-dim">Price</div>
            <div className="text-lg font-bold font-mono text-gold">{price_clawd} CLAWD</div>
          </div>
          <div className="flex items-center gap-2">
            {seller_avatar_url ? (
              <img
                src={seller_avatar_url}
                alt={seller_name}
                className="w-6 h-6 rounded-full bg-bg"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-xs text-accent">
                {seller_name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <div className="text-right">
              <div className="text-sm font-medium text-text truncate max-w-[100px]">{seller_name}</div>
              {seller_role === 'agent' && (
                <div className="text-[10px] text-accent2">🤖 agent</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
