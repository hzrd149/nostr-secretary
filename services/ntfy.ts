import config$, { configValue } from "./config";
import { firstValueFrom } from "rxjs";
import { log } from "./logs";

/**
 * Priority levels for ntfy notifications
 */
export enum NtfyPriority {
  Min = 1,
  Low = 2,
  Default = 3,
  High = 4,
  Max = 5,
}

/**
 * Action types for interactive ntfy notifications
 */
export interface NtfyAction {
  /** Action identifier */
  action: "view" | "http" | "broadcast";
  /** Action label displayed to user */
  label: string;
  /** URL for view/http actions or intent for broadcast actions */
  url?: string;
  /** HTTP method for http actions (default: POST) */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Headers for http actions */
  headers?: Record<string, string>;
  /** Body for http actions */
  body?: string;
  /** Intent for broadcast actions */
  intent?: string;
  /** Extras for broadcast actions */
  extras?: Record<string, string>;
  /** Clear notification after action (default: false) */
  clear?: boolean;
}

/**
 * Options for sending ntfy notifications
 */
export interface NtfyNotificationOptions {
  /** Notification title */
  title?: string;
  /** Notification message (required) */
  message: string;
  /** Topic to send to (overrides config) */
  topic?: string;
  /** Server URL (overrides config) */
  server?: string;
  /** Priority level (1-5) */
  priority?: NtfyPriority | number;
  /** Tags for categorization and icons */
  tags?: string[];
  /** Delay delivery (e.g., "30min", "9am", "Monday 8:30am") */
  delay?: string;
  /** Notification click action URL */
  click?: string;
  /** Attachment URL */
  attach?: string;
  /** Attachment filename */
  filename?: string;
  /** Email address for email notifications */
  email?: string;
  /** Call phone number */
  call?: string;
  /** Custom icon URL */
  icon?: string;
  /** Interactive actions */
  actions?: NtfyAction[];
  /** Markdown formatting (default: false) */
  markdown?: boolean;
}

/**
 * Response from ntfy server
 */
export interface NtfyResponse {
  /** Unique message ID */
  id: string;
  /** Unix timestamp */
  time: number;
  /** Expiration timestamp */
  expires: number;
  /** Event type */
  event: string;
  /** Topic */
  topic: string;
  /** Message */
  message: string;
  /** Title */
  title?: string;
  /** Priority */
  priority?: number;
  /** Tags */
  tags?: string[];
}

/**
 * Error response from ntfy server
 */
export interface NtfyError {
  /** Error code */
  code: number;
  /** HTTP status */
  http: number;
  /** Error message */
  error: string;
}

/**
 * Custom error class for ntfy operations
 */
export class NtfyServiceError extends Error {
  constructor(
    message: string,
    public code?: number,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = "NtfyServiceError";
  }
}

/**
 * Send a notification via ntfy
 */
export async function sendNotification(
  options: NtfyNotificationOptions,
): Promise<NtfyResponse> {
  // Get config values
  const currentConfig = config$.getValue();
  const server = options.server || currentConfig.server || "https://ntfy.sh";
  const topic = options.topic || currentConfig.topic;

  // Validate required fields
  if (!server) throw new NtfyServiceError("No ntfy server configured", 400);
  if (!topic) throw new NtfyServiceError("No ntfy topic configured", 400);
  if (!options.message?.trim())
    throw new NtfyServiceError("Message is required", 400);

  // Construct URL
  const url = new URL("/" + topic, server);

  // Prepare headers
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
  };

  // Add optional headers
  if (options.title) headers["X-Title"] = options.title;
  if (options.priority !== undefined)
    headers["X-Priority"] = String(options.priority);
  if (options.tags?.length) headers["X-Tags"] = options.tags.join(",");
  if (options.delay) headers["X-Delay"] = options.delay;
  if (options.click) headers["X-Click"] = options.click;
  if (options.attach) headers["X-Attach"] = options.attach;
  if (options.filename) headers["X-Filename"] = options.filename;
  if (options.email) headers["X-Email"] = options.email;
  else if (currentConfig.email) headers["X-Email"] = currentConfig.email;
  if (options.call) headers["X-Call"] = options.call;
  if (options.icon) headers["X-Icon"] = options.icon;
  if (options.markdown) headers["X-Markdown"] = "yes";

  // Add actions if present
  if (options.actions?.length) {
    options.actions.forEach((action, index) => {
      const actionStr = [
        action.action,
        action.label,
        action.url || "",
        action.method || "",
        Object.entries(action.headers || {})
          .map(([k, v]) => `${k}=${v}`)
          .join(","),
        action.body || "",
        action.intent || "",
        Object.entries(action.extras || {})
          .map(([k, v]) => `${k}=${v}`)
          .join(","),
        action.clear ? "true" : "false",
      ].join(", ");

      headers[`X-Actions`] = headers[`X-Actions`]
        ? `${headers[`X-Actions`]}, ${actionStr}`
        : actionStr;
    });
  }

  try {
    log("Sending ntfy notification", {
      topic,
      server,
      options,
    });

    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: options.message,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

      try {
        const errorData = (await response.json()) as NtfyError;
        errorMessage = errorData.error || errorMessage;
        throw new NtfyServiceError(
          errorMessage,
          errorData.code,
          errorData.http,
        );
      } catch (parseError) {
        throw new NtfyServiceError(errorMessage, undefined, response.status);
      }
    }

    const result = (await response.json()) as NtfyResponse;
    return result;
  } catch (error) {
    if (error instanceof NtfyServiceError) throw error;

    if (error instanceof Error)
      throw new NtfyServiceError(`Network error: ${error.message}`);

    throw new NtfyServiceError("Unknown error occurred");
  }
}

/**
 * Send a simple text notification
 */
export async function sendSimpleNotification(
  message: string,
  title?: string,
): Promise<NtfyResponse> {
  return sendNotification({ message, title });
}

/**
 * Send a high priority notification
 */
export async function sendUrgentNotification(
  message: string,
  title?: string,
): Promise<NtfyResponse> {
  return sendNotification({
    message,
    title,
    priority: NtfyPriority.High,
    tags: ["warning", "rotating_light"],
  });
}
