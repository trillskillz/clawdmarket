import { platformGraph } from '@/lib/seo-jsonld';

export default function Head() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(platformGraph()) }}
      />
    </>
  );
}
