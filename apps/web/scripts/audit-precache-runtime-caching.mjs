export const FORBIDDEN_RUNTIME_CACHING_PATTERN =
  /rest\/v1|functions\/v1|supabase\.co|NetworkFirst|StaleWhileRevalidate/;

export function containsForbiddenRuntimeCaching(swSource) {
  return FORBIDDEN_RUNTIME_CACHING_PATTERN.test(swSource);
}
