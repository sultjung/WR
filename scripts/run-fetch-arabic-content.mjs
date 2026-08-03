#!/usr/bin/env node

const configuredFetchTimeout = Number(process.env.CONTENT_FETCH_TIMEOUT_MS || 18000);
const FETCH_HARD_TIMEOUT_MS = Number(
  process.env.CONTENT_FETCH_HARD_TIMEOUT_MS || configuredFetchTimeout + 5000
);
const BODY_TIMEOUT_MS = Number(
  process.env.CONTENT_BODY_TIMEOUT_MS || configuredFetchTimeout + 5000
);

function withTimeout(promise, timeoutMs, code) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

const nativeFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (...args) => {
  const response = await withTimeout(
    nativeFetch(...args),
    FETCH_HARD_TIMEOUT_MS,
    "CONTENT_FETCH_HARD_TIMEOUT"
  );

  return new Proxy(response, {
    get(target, property) {
      if (property === "text") {
        return () => withTimeout(
          target.text(),
          BODY_TIMEOUT_MS,
          "CONTENT_BODY_TIMEOUT"
        );
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
};

console.log(
  `[content-runner] fetchHardTimeout=${FETCH_HARD_TIMEOUT_MS}ms, bodyTimeout=${BODY_TIMEOUT_MS}ms`
);

try {
  await import("./fetch-arabic-content.mjs");
} catch (error) {
  console.error(`[content-runner] ${String(error?.stack || error)}`);
  process.exitCode = 1;
}
