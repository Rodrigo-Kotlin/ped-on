import { queryOptions } from '@tanstack/react-query';
import { fetchPublicMenu } from './menu';

export function publicMenuQueryKey(publicSlug: string) {
  return ['public-menu', publicSlug] as const;
}

export function publicMenuQueryOptions(publicSlug: string) {
  return queryOptions({
    queryKey: publicMenuQueryKey(publicSlug),
    queryFn: () => fetchPublicMenu(publicSlug),
    enabled: publicSlug !== '',
  });
}
