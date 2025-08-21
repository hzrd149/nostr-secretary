export const logs: { message: string; details?: Record<string, any> }[] = [];
export function log(message: string, details?: Record<string, any>) {
  if (details) console.log(message, details);
  else console.log(message);

  logs.push({ message, details });

  // Prune logs
  if (logs.length > 10_000) logs.shift();
}
