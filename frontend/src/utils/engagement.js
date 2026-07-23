// Maps the engine's engagement_level / engagement_stage to display badges + labels.
// Mirrors backend presenter.js so the vocabulary stays consistent.

const LEVEL_META = {
  none: { cls: 'badge-muted', label: 'No signal' },
  low: { cls: 'badge-warn', label: 'Low' },
  medium: { cls: 'badge-info', label: 'Medium' },
  high: { cls: 'badge-info', label: 'High' },
  verified: { cls: 'badge-success', label: 'Verified' },
}
export const levelMeta = (lvl) => LEVEL_META[lvl] || LEVEL_META.none

const STAGE_LABEL = {
  delivered: 'Delivered',
  open_signal: 'Open Signal',
  likely_engaged: 'Likely Viewed',
  verified_human: 'Verified Engagement',
}
export const stageLabel = (s) => STAGE_LABEL[s] || 'Delivered'

// High → low ordering for summary chips.
export const LEVELS = ['verified', 'high', 'medium', 'low', 'none']
export const LEVEL_SUMMARY_LABEL = {
  verified: 'Verified',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No signal',
}
