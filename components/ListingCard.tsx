import Link from 'next/link';
import Image from 'next/image';
import PriceWithKas from '@/components/PriceWithKas';

interface ListingCardProps {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  category: string;
  price_bankr: number;
  seller_name: string;
  seller_role?: string;
  seller_avatar_url?: string | null;
  seller_avatar_emoji?: string | null;
  created_at: Date;
}

const categoryIcons: Record<string, string> = {
  compute: '⚡',
  skills: '🧩',
  data: '📊',
  bounties: '🎯',
  other: '💨',
};

const categoryColors: Record<string, string> = {
  compute: 'text-accent2 border-accent/30',
  skills: 'text-gold border-gold/30',
  data: 'text-green-400 border-green-400/30',
  bounties: 'text-blue-400 border-blue-400/30',
  other: 'text-gray-300 border-gray-300/30',
};

export default function ListingCard({
  id,
  seller_id,
  title,
  description,
  category,
  price_bankr,
  seller_name,
  seller_role,
  seller_avatar_url,
  seller_avatar_emoji,
  created_at,
}: ListingCardProps) {
  return (
    <div className="card-glow gradient-border hover:shadow-lg hover:shadow-accent/10 h-full flex flex-col p-6 relative group">
      <Link href={`/marketplace/${id}`} className="absolute inset-0 z-0" aria-label={`View listing: ${title}`} />
      
      <div className="flex items-start justify-between mb-3 relative z-10 pointer-events-none">
        <span className={`text-2xl ${categoryIcons[category] ? '' : 'hidden'}`}>
          {categoryIcons[category] || '📦'}
        </span>
        <span className={`text-xs px-3 py-1 border rounded-full font-medium ${categoryColors[category] || 'text-text-dim border-border'}`}>
          {category}
        </span>
      </div>
      
      <h3 className="text-lg font-semibold mb-2 text-text line-clamp-2 relative z-10 pointer-events-none">{title}</h3>
      
      <p className="text-sm text-text-dim mb-4 line-clamp-3 flex-grow relative z-10 pointer-events-none">{description}</p>
      
      <div className="flex items-center justify-between pt-4 border-t border-border mt-auto relative z-20">
        <div className="pointer-events-none">
          <div className="text-xs text-text-dim">Price</div>
          <div className="text-sm font-bold font-mono text-gold leading-tight">
            <PriceWithKas bankr={price_bankr} kasClassName="text-xs text-text-dim" />
          </div>
        </div>
        
        <Link 
          href={`/users/${seller_id}`}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity p-1 rounded hover:bg-accent/10 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          {seller_avatar_url ? (
            <Image
              src={seller_avatar_url}
              alt={seller_name}
              width={24}
              height={24}
              className="w-6 h-6 rounded-full bg-bg object-cover"
            />
          ) : seller_avatar_emoji ? (
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-sm">
              {seller_avatar_emoji}
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-xs text-accent">
              {seller_name?.[0]?.toUpperCase() || '?'}
            </div>
          )}
          <div className="text-right">
            <div className="text-sm font-medium text-text truncate max-w-[100px]">{seller_name}</div>
            <div className="text-[10px] text-accent2">{seller_role === 'agent' ? '🤖 agent' : '👤 user'}</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
