export interface ToolCategory {
  name: string;
  pattern: RegExp;
  description: string;
  requiresOrgMode?: boolean;
}

export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  mail: {
    name: 'mail',
    pattern: /mail|attachment|draft/i,
    description: 'Email operations (read, send, manage folders, attachments)',
  },
  calendar: {
    name: 'calendar',
    pattern: /calendar|event/i,
    description: 'Calendar and event management',
  },
};

export function getCombinedPresetPattern(presets: string[]): string {
  const patterns = presets.map((preset) => {
    const category = TOOL_CATEGORIES[preset];
    if (!category) {
      throw new Error(
        `Unknown preset: ${preset}. Available presets: ${Object.keys(TOOL_CATEGORIES).join(', ')}`
      );
    }
    return category.pattern.source;
  });
  return patterns.join('|');
}

export function listPresets(): Array<{
  name: string;
  description: string;
  requiresOrgMode?: boolean;
}> {
  return Object.values(TOOL_CATEGORIES).map((category) => ({
    name: category.name,
    description: category.description,
    requiresOrgMode: category.requiresOrgMode,
  }));
}

export function presetRequiresOrgMode(preset: string): boolean {
  const category = TOOL_CATEGORIES[preset];
  return category?.requiresOrgMode || false;
}
