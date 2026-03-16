// Simple logger with timestamp and color for learning sessions
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};

const ts = () => `${colors.dim}[${new Date().toISOString().split("T")[1].slice(0, 12)}]${colors.reset}`;

export const log = {
  info:  (msg: string) => console.log(`${ts()} ${colors.cyan}info${colors.reset}  ${msg}`),
  tool:  (msg: string) => console.log(`${ts()} ${colors.yellow}tool${colors.reset}  ${msg}`),
  agent: (msg: string) => console.log(`${ts()} ${colors.blue}agent${colors.reset} ${msg}`),
  ok:    (msg: string) => console.log(`${ts()} ${colors.green}ok${colors.reset}    ${msg}`),
  error: (msg: string) => console.error(`${ts()} ${colors.red}error${colors.reset} ${msg}`),
};
