import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

// Angular 22 is zoneless by default and zone.js is NOT part of the build (no polyfills entry in
// angular.json). Keeping provideZoneChangeDetection() here bootstraps in zone mode without Zone.js
// → NG0908 ("Angular requires Zone.js") → a permanently blank <app-root>. The backoffice-web
// already uses this zoneless config; the frontoffice must too.
export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideRouter(routes)],
};
