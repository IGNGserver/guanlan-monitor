# Device State Console v3.0.165

## Android tablet and landscape experience

- **One UI navigation & layout**: Enabled `OneUiNavigationRail` for Medium and Expanded viewports (folding devices, tablets, and landscape phones), recovering vertical height by eliminating the bottom navigation bar.
- **Master-detail two-pane layout**: Restricted two-pane master-detail strictly to the Overview destination (`DeviceList` / `DeviceDetail` / `Traffic`). The left device list highlights the currently selected device, and the right detail pane opens the selected device by default instead of leaving an empty state placeholder.
- **Consistent top-level destinations**: Attention and Settings remain full-width standalone destinations across portrait, landscape, and tablets, keeping top-level navigation mental models identical.
- **Embedded pane alignment**: Introduced `OneUiEmbeddedPane` so embedded panes automatically align top bars, group headers, and list cards with a unified 16 dp margin, eliminating double-margin indentations.
- **Dense landscape detail and traffic views**: Combined the detail tab segmented row and range chips into a single row on wide screens, added a horizontal block quick-switch bar in hardware detail, and redesigned the traffic screen into a side-by-side calendar and range records view.

## Validation

- Android contract tests and tablet landscape Robolectric smoke renders passed in CI.
- Full verification passed in CI across all platforms.
