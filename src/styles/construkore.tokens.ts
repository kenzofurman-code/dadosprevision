/** Tokens visuais oficiais do ConstruKORE. Componentes devem usar intenções semânticas. */
export const lightTokens = {
  surface: { page: '#F6F4EE', panel: '#FFFFFF', subtle: '#F7F8F9', overlay: 'rgb(16 24 32 / 0.52)', navigation: '#101820', navigationHover: '#2B343D', navigationText: '#C9D3DE' },
  content: { primary: '#14171C', secondary: '#484E58', muted: '#7C828D', onAction: '#FFFFFF' },
  border: { strong: '#E0DDD3', subtle: '#EEEBE3', focus: '#1F4E9C' },
  state: {
    success: { solid: '#2E6B4C', soft: '#E6EFEA', text: '#2E6B4C' },
    positive: { solid: '#17784F', soft: '#E4F1EA', text: '#17784F' },
    warning: { solid: '#B4640F', soft: '#FAEEE0', text: '#8A4C0B' },
    danger: { solid: '#A3271F', soft: '#F8E7E4', text: '#A3271F' },
    action: { solid: '#1F4E9C', soft: '#E8EEF8', text: '#1F4E9C' },
    neutral: { solid: '#9AA0AA', soft: '#F1EFE9', text: '#5E646E' },
  },
  chart: {
    progress: ['#EEEBE3', '#C9D6E8', '#9CB6D9', '#6E93C6', '#4571B0', '#1F4E9C', '#143564'],
    deviation: ['#1F4E9C', '#6E93C6', '#C9D6E8', '#EEEBE3', '#F0CBA8', '#D08E43', '#B4640F', '#A3271F'],
    categorical: ['#1F4E9C', '#A85B0D', '#2E6B4C', '#8B3A62', '#4A6FA5', '#7D5F1B', '#0E5A52', '#6B4C9A', '#A3271F', '#3D7A6B', '#A06726', '#5B3A8C', '#175E8C', '#6E6029', '#9A4A3C', '#456B2F'],
  },
  typography: { ui: "'IBM Plex Sans', Inter, system-ui, sans-serif", mono: "'IBM Plex Mono', ui-monospace, monospace", label: { size: '10px', weight: 600, tracking: '.09em' }, body: { size: '13px', weight: 400 }, heading: { size: '20px', weight: 700 }, metric: { size: '24px', weight: 600 } },
  shape: { radius: { chip: '3px', field: '5px', card: '7px', navigation: '8px', pill: '999px' }, spacing: { tight: '4px', default: '9px', relaxed: '14px', section: '16px' }, shadow: '0 2px 8px rgba(20,23,28,.09)' },
} as const;

export const lightThemeCss = `
:root {
  --kore-paper: ${lightTokens.surface.page}; --kore-panel: ${lightTokens.surface.panel}; --kore-panel-subtle: ${lightTokens.surface.subtle}; --kore-overlay: ${lightTokens.surface.overlay};
  --kore-ink: ${lightTokens.content.primary}; --kore-ink-secondary: ${lightTokens.content.secondary}; --kore-ink-muted: ${lightTokens.content.muted}; --kore-on-action: ${lightTokens.content.onAction};
  --kore-rule: ${lightTokens.border.strong}; --kore-rule-subtle: ${lightTokens.border.subtle};
  --kore-action: ${lightTokens.state.action.solid}; --kore-action-soft: ${lightTokens.state.action.soft};
  --kore-success: ${lightTokens.state.success.solid}; --kore-success-soft: ${lightTokens.state.success.soft};
  --kore-warning: ${lightTokens.state.warning.solid}; --kore-warning-soft: ${lightTokens.state.warning.soft};
  --kore-danger: ${lightTokens.state.danger.solid}; --kore-danger-soft: ${lightTokens.state.danger.soft};
  --kore-radius-field: ${lightTokens.shape.radius.field}; --kore-radius-card: ${lightTokens.shape.radius.card};
}
`;
