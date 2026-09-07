/**
 * Trusted application identities for Windows window/process resolution.
 * Prefer executable / process identity over window title.
 */

export type KnownApplication = {
  id: string;
  displayName: string;
  aliases: string[];
  /** Lowercase executable basenames, e.g. spotify.exe */
  executables: string[];
};

export const KNOWN_APPLICATIONS: KnownApplication[] = [
  {
    id: "spotify",
    displayName: "Spotify",
    aliases: ["spotify"],
    executables: ["spotify.exe"],
  },
  {
    id: "chrome",
    displayName: "Google Chrome",
    aliases: ["chrome", "google chrome"],
    executables: ["chrome.exe"],
  },
  {
    id: "msedge",
    displayName: "Microsoft Edge",
    aliases: ["edge", "microsoft edge", "msedge"],
    executables: ["msedge.exe"],
  },
  {
    id: "firefox",
    displayName: "Firefox",
    aliases: ["firefox"],
    executables: ["firefox.exe"],
  },
  {
    id: "explorer",
    displayName: "File Explorer",
    aliases: ["file explorer", "explorer", "windows explorer"],
    executables: ["explorer.exe"],
  },
  {
    id: "calculator",
    displayName: "Calculator",
    aliases: ["calculator", "calc"],
    executables: ["calculator.exe", "calc.exe"],
  },
  {
    id: "notepad",
    displayName: "Notepad",
    aliases: ["notepad"],
    executables: ["notepad.exe"],
  },
  {
    id: "discord",
    displayName: "Discord",
    aliases: ["discord"],
    executables: ["discord.exe"],
  },
  {
    id: "slack",
    displayName: "Slack",
    aliases: ["slack"],
    executables: ["slack.exe"],
  },
  {
    id: "code",
    displayName: "Visual Studio Code",
    aliases: ["vscode", "vs code", "code", "visual studio code"],
    executables: ["code.exe"],
  },
];

export function resolveKnownApplication(
  query: string,
): KnownApplication | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  for (const app of KNOWN_APPLICATIONS) {
    if (app.id === q) return app;
    if (app.aliases.some((a) => a === q || q.includes(a) || a.includes(q))) {
      return app;
    }
    if (app.executables.some((e) => e === q || e.replace(/\.exe$/, "") === q)) {
      return app;
    }
  }
  return null;
}
