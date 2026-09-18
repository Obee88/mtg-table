import type { CardPrinting } from '@mtg/shared';
import { useCardPreview } from './CardPreview';

/** Smallest image that is still readable at the given display size. */
export function imageFor(card: Pick<CardPrinting, 'imageUris'>, size: 'small' | 'normal' | 'large'): string | null {
  const uris = card.imageUris;
  if (!uris) return null;
  return uris[size] ?? uris.normal ?? uris.large ?? uris.small ?? null;
}

export function CardImage({ card, className = '' }: { card: CardPrinting; className?: string }) {
  const src = imageFor(card, 'small');
  const preview = useCardPreview(imageFor(card, 'normal'));
  return (
    <div className={`aspect-[5/7] overflow-hidden rounded-[4.5%] bg-surface-raised ${className}`} {...preview}>
      {src ? (
        <img src={src} alt={card.name} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center p-2 text-center text-xs text-text-muted">{card.name}</div>
      )}
    </div>
  );
}
