export function devLog(message?: unknown, ...optionalParams: unknown[]) {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    console.log(message, ...optionalParams);
  }
}
