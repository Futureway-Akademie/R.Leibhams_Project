/**
 * Editor-Ansicht des Blocks „Buchungskalender“ ohne Build-Schritt. Im Editor erscheint ein
 * Platzhalter; das eigentliche Widget rendert der Server auf der Seite.
 */
(function (blocks, element, blockEditor, components, i18n) {
  'use strict';

  const el = element.createElement;
  const __ = i18n.__;
  const SERVICE_ID = /^[0-9a-f]{24}$/;

  blocks.registerBlockType('fw-booking/calendar', {
    edit: function (props) {
      const service = props.attributes.service || '';
      const invalid = service !== '' && !SERVICE_ID.test(service);
      return el(
        element.Fragment,
        null,
        el(
          blockEditor.InspectorControls,
          null,
          el(
            components.PanelBody,
            { title: __('Angebot', 'fw-booking') },
            el(components.TextControl, {
              label: __('Angebots-ID (optional)', 'fw-booking'),
              help: invalid
                ? __('Ungültig: 24 Zeichen 0–9 und a–f.', 'fw-booking')
                : __('Leer lassen, um alle Angebote zur Auswahl zu zeigen.', 'fw-booking'),
              value: service,
              __nextHasNoMarginBottom: true,
              onChange: function (value) {
                props.setAttributes({ service: value.trim() });
              },
            }),
          ),
        ),
        el(
          'div',
          blockEditor.useBlockProps(),
          el(components.Placeholder, {
            icon: 'calendar-alt',
            label: __('Buchungskalender', 'fw-booking'),
            instructions: service
              ? __('Zeigt das gewählte Angebot zur Buchung.', 'fw-booking')
              : __(
                  'Zeigt alle Angebote zur Buchung. Die Darstellung erscheint auf der Seite.',
                  'fw-booking',
                ),
          }),
        ),
      );
    },
    save: function () {
      return null;
    },
  });
})(
  window.wp.blocks,
  window.wp.element,
  window.wp.blockEditor,
  window.wp.components,
  window.wp.i18n,
);
