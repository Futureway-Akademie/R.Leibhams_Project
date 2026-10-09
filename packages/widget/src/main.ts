// Einstieg des IIFE-Bundles (dist/fw-booking-widget.js). Das importierte Stylesheet landet als
// eigene Datei dist/fw-booking-widget.css im Build (kein Inline-<style>, CSP-freundlich).
import './styles/widget.css';
import { install } from './bootstrap.js';

install(window);
