export const WORKSPACE_COLOR_FIELDS = [
  { key: "background", label: "App background", variables: ["--background"] },
  { key: "chat", label: "Chat background", variables: ["--brand-chat-canvas"] },
  { key: "sidebar", label: "Sidebar", variables: ["--sidebar"] },
  { key: "header", label: "Header", variables: ["--brand-header"] },
  {
    key: "wordmark",
    label: "Crackerbox wordmark",
    variables: ["--brand-wordmark"],
  },
  {
    key: "text",
    label: "Main text",
    variables: ["--foreground", "--sidebar-foreground"],
  },
  {
    key: "subtleText",
    label: "Subdued text",
    variables: ["--muted-foreground"],
  },
  {
    key: "surfaces",
    label: "Panels and chat box",
    variables: ["--background-lighter", "--card", "--popover"],
  },
  {
    key: "accent",
    label: "Accent and selected items",
    variables: ["--primary", "--brand-pinstripe"],
  },
] as const;

export type WorkspaceColorKey = (typeof WORKSPACE_COLOR_FIELDS)[number]["key"];
export type WorkspaceColors = Partial<Record<WorkspaceColorKey, string>>;

export const WORKSPACE_COLOR_PRESETS: Record<string, WorkspaceColors> = {
  "Olive Night": {
    background: "#171c17",
    chat: "#171c17",
    sidebar: "#242c22",
    header: "#1c231b",
    wordmark: "#3a4738",
    text: "#f6f8f3",
    subtleText: "#a6afa2",
    surfaces: "#222920",
    accent: "#879b78",
  },
  Graphite: {
    background: "#151617",
    chat: "#151617",
    sidebar: "#242629",
    header: "#1c1e20",
    wordmark: "#383c3f",
    text: "#f5f5f4",
    subtleText: "#a8aaa9",
    surfaces: "#222426",
    accent: "#8c9ba3",
  },
  "Dark Roast": {
    background: "#1c1714",
    chat: "#1c1714",
    sidebar: "#302720",
    header: "#251e19",
    wordmark: "#4b3b30",
    text: "#f8f3eb",
    subtleText: "#b3a79b",
    surfaces: "#2a221d",
    accent: "#a48b72",
  },
};

export const WORKSPACE_COLOR_FALLBACKS = {
  dark: WORKSPACE_COLOR_PRESETS["Olive Night"],
  light: {
    background: "#f5f7f1",
    chat: "#f5f7f1",
    sidebar: "#e8ece4",
    header: "#e8ece4",
    wordmark: "#dce4d6",
    text: "#242924",
    subtleText: "#626b60",
    surfaces: "#ffffff",
    accent: "#70845d",
  },
} as const;

export function applyWorkspaceColors(
  colors: WorkspaceColors,
  root: HTMLElement,
) {
  for (const field of WORKSPACE_COLOR_FIELDS) {
    for (const variable of field.variables) {
      const value = colors[field.key];
      if (value) root.style.setProperty(variable, value);
      else root.style.removeProperty(variable);
    }
  }
}
