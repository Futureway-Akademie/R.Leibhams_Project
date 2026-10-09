// Öffentliche Bausteine des Widgets für Tests und spätere Ansichten. Ausgeliefert wird das
// IIFE-Bundle aus src/main.ts.
export { CONTAINER_SELECTOR, readConfig } from './config.js';
export type { ConfigResult, WidgetConfig } from './config.js';
export { ApiError, DEFAULT_TIMEOUT_MS, createApiClient } from './api/client.js';
export type { ApiClient, ApiClientOptions, ApiErrorKind } from './api/client.js';
export { STATE_ATTRIBUTE, createInstance } from './instance.js';
export type { InstanceOptions, WidgetInstance } from './instance.js';
export { SELECT_EVENT, startApp } from './app.js';
export type { App, AppOptions, Selection, SessionSelection, SlotSelection } from './app.js';
export { MAX_MONTHS_AHEAD } from './views/single.js';
export { SESSION_WINDOW_DAYS } from './views/course.js';
export { WIDGET_VERSION, install } from './bootstrap.js';
export type { FwBookingApi, InstallOptions } from './bootstrap.js';
