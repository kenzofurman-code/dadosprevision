import { lightTokens } from './construkore.tokens';

/** Tema escuro com o mesmo contrato semântico do tema claro. */
export const darkTokens = {
  ...lightTokens,
  surface: { ...lightTokens.surface, page: '#14161A', panel: '#22262C', subtle: '#1E2127', overlay: 'rgb(4 8 12 / 0.68)', navigation: '#101820', navigationHover: '#2B343D', navigationText: '#C9D3DE' },
  content: { primary: '#E8E6E1', secondary: '#B4B0A8', muted: '#9B9891', onAction: '#14161A' },
  border: { strong: '#333840', subtle: '#2A2E35', focus: '#6699DD' },
  state: {
    success: { solid: '#4E9E75', soft: '#1B2C24', text: '#7DBF9C' }, positive: { solid: '#3F9E70', soft: '#182B22', text: '#6FBE97' },
    warning: { solid: '#D9913F', soft: '#2E2418', text: '#E5AE69' }, danger: { solid: '#D96B5F', soft: '#301E1C', text: '#E89286' },
    action: { solid: '#6699DD', soft: '#1A2434', text: '#8FB6E8' }, neutral: { solid: '#8C919B', soft: '#232730', text: '#9DA2AB' },
  },
  chart: { ...lightTokens.chart, progress: ['#262A31', '#2E4055', '#3A5878', '#48719B', '#5A8BBE', '#77A6D6', '#9CC2E6'], deviation: ['#6699DD', '#4E7CB8', '#3A5878', '#2A2E35', '#4A3A28', '#8A6234', '#C08640', '#D96B5F'], categorical: ['#6699DD', '#D9913F', '#5FB088', '#D87BA8', '#8FAAD4', '#C4A961', '#4FB3A5', '#A98CD9', '#E08479', '#6FBBA3', '#D4A063', '#9B85D4', '#66A8D4', '#BCAE6B', '#DB9086', '#8FBA6B'] },
  shape: { ...lightTokens.shape, shadow: '0 2px 10px rgba(0,0,0,.35)' },
} as const;

export const darkThemeCss = `
[data-theme='dark'] {
  color-scheme: dark;
  --kore-paper: ${darkTokens.surface.page}; --kore-panel: ${darkTokens.surface.panel}; --kore-panel-subtle: ${darkTokens.surface.subtle}; --kore-overlay: ${darkTokens.surface.overlay};
  --kore-ink: ${darkTokens.content.primary}; --kore-ink-secondary: ${darkTokens.content.secondary}; --kore-ink-muted: ${darkTokens.content.muted}; --kore-on-action: ${darkTokens.content.onAction};
  --kore-rule: ${darkTokens.border.strong}; --kore-rule-subtle: ${darkTokens.border.subtle};
  --kore-action: ${darkTokens.state.action.solid}; --kore-action-soft: ${darkTokens.state.action.soft};
  --kore-success: ${darkTokens.state.success.solid}; --kore-success-soft: ${darkTokens.state.success.soft};
  --kore-warning: ${darkTokens.state.warning.solid}; --kore-warning-soft: ${darkTokens.state.warning.soft};
  --kore-danger: ${darkTokens.state.danger.solid}; --kore-danger-soft: ${darkTokens.state.danger.soft};
  --kore-radius-field: ${darkTokens.shape.radius.field}; --kore-radius-card: ${darkTokens.shape.radius.card};
}
`;
