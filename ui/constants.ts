// Console specs live one level up (shared with the host mcp/ capability). Re-
// export them here so the ui keeps importing from './constants'.
export {
  CONSOLES,
  DEFAULT_CONSOLE,
  consoleSpec,
  consoleLabel,
  consoleCore,
  type ConsoleSpec,
  type CatalogEntry,
  type Catalog,
} from '../consoles';
