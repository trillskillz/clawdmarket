import { db } from '@/lib/db';
import { listings, users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { offerFromListing, platformGraph } from '@/lib/seo-jsonld';

type Props = { params: { id: string } };

export default async function ListingHead({ params }: Props) {
  const row = await db
    .select({
      id: listings.id,
      title: listings.title,
      description: listings.description,
      price_bankr: listings.price_bankr,
      seller_name: users.name,
    })
    .from(listings)
    .leftJoin(users, eq(users.id, listings.seller_id))
    .where(eq(listings.id, params.id))
    .limit(1);

  const listing = row[0];
  if (!listing) return null;

  const graph = {
    ...platformGraph(),
    '@graph': [
      ...platformGraph()['@graph'],
      offerFromListing({
        id: listing.id,
        title: listing.title,
        description: listing.description,
        price: Number(listing.price_bankr || 0),
        urlPath: `/marketplace/${listing.id}`,
        sellerName: listing.seller_name || undefined,
      }),
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
