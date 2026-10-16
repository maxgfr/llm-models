// Browser entry point (package.json "browser" / exports "browser" condition):
// the same API as the Node entry, with the cache kept in memory and no config
// file. It imports no Node.js builtin, so any bundler can ship it to a page.

export * from "./lib";
