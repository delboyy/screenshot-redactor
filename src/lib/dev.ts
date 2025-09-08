export function devLog(message?: unknown, ...optionalParams: unknown[]) {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.log(message, ...optionalParams);
  }
}

