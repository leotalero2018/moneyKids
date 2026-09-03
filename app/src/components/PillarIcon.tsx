import type { Pillar } from '../lib/catalog.js';

const EMOJI: Record<Pillar, string> = {
  learn: '📚', courage: '🦁', ideas: '💡', help: '🤝',
};

export function PillarIcon({ pillar }: { pillar: Pillar }) {
  return <span aria-hidden="true">{EMOJI[pillar]}</span>;
}
