import { Badge } from '@/components/ui/badge';
import type { Category } from '@/lib/types';

interface CategoryBadgeProps {
  category: Pick<Category, 'display_name' | 'color'>;
}

export function CategoryBadge({ category }: CategoryBadgeProps) {
  const hex = category.color ?? '#71717a';
  return (
    <Badge
      variant="outline"
      style={{
        borderColor: hex,
        color: hex,
        backgroundColor: hex + '33',
      }}
      className="text-xs font-medium max-w-full min-w-0"
    >
      <span className="truncate">{category.display_name}</span>
    </Badge>
  );
}
