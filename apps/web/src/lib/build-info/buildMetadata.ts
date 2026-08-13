declare const __BUILD_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_TIMESTAMP__: string;

export interface BuildMetadata {
  version: string;
  sha: string;
  timestamp: string;
}

export const buildMetadata: BuildMetadata = {
  version: typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : '0.0.0',
  sha: typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'local',
  timestamp:
    typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : new Date(0).toISOString(),
};

export function formatBuildTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}
