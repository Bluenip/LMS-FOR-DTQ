import type { Assignment } from './types';

type WordLimits = Pick<Assignment, 'minWords' | 'maxWords'>;

export function wordRequirement({ minWords, maxWords }: WordLimits) {
  if (maxWords != null) return `từ ${minWords} đến ${maxWords} từ`;
  if (minWords > 0) return `tối thiểu ${minWords} từ, không giới hạn tối đa`;
  return 'không giới hạn số từ';
}

export function acceptsWordCount(count: number, { minWords, maxWords }: WordLimits) {
  return count >= minWords && (maxWords == null || count <= maxWords);
}
