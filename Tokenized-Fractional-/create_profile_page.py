import os

# Determine the Tokenized-Fractional- repo path
BASE = os.path.dirname(os.path.abspath(__file__))
CSS_PATH = os.path.join(BASE, 'frontend', 'src', 'components', 'ProfilePage', 'ProfilePage.module.css')

css_content = """.container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

/* Connect prompt */
.connectPrompt {
  text-align: center;
  padding: var(--spacing-2xl);
}
.connectInner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-lg);
  max-width: 480px;
  margin: 0 auto;
}
.connectIcon {
  color: var(--primary);
  opacity: 0.6;
  margin-bottom: var(--spacing-md);
}
.connectTitle {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  margin: 0;
}
.connectSub {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  margin: 0;
}

/* Profile Header */
.profileHeader {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg);
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  flex-wrap: wrap;
}
.profileAvatar {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-circle);
  background: var(--bg-surface-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.profileAvatar svg {
  width: 28px;
  height: 28px;
}
.profileInfo {
  flex: 1;
  min-width: 200px;
}
.profileName {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  margin: 0 0 var(--spacing-xs) 0;
}
.walletRow {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
.walletAddress {
  font-size: var(--font-size-xs);
  background: var(--bg-surface-hover);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}
.copyBtn {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  padding: var(--spacing-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.copyBtn:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-glow);
}
.copied {
  color: var(--success) !important;
  border-color: var(--success-border) !important;
  background: var(--success-bg) !important;
}
.profileActions {
  display: flex;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

/* Tab Navigation */
.tabNav {
  display: flex;
  gap: var(--spacing-xs);
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: var(--spacing-xs);
  overflow-x: auto;
}
.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
  white-space: nowrap;
}
.tab:hover {
  color: var(--text-secondary);
  background: var(--bg-surface-hover);
}
.tabActive {
  color: var(--primary) !important;
  background: var(--primary-glow) !important;
}

/* Tab Content */
.tabContent {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

/* Summary Cards */
.summaryGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--spacing-md);
}
.summaryCard {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
}
.summaryIcon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--primary-glow);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.summaryIcon svg {
  width: 20px;
  height: 20px;
}
.summaryBody {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.summaryValue {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.summaryLabel {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.summaryTrend {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--success-text);
  margin-top: var(--spacing-xs);
}

/* Asset Allocation */
.allocationCard {
  padding: var(--spacing-lg);
}
.sectionTitle {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  margin: 0 0 var(--spacing-md) 0;
}
.allocationBar {
  display: flex;
  height: 8px;
  border-radius: var(--radius-circle);
  overflow: hidden;
  background: var(--bg-surface-hover);
  margin-bottom: var(--spacing-md);
}
.allocationSegment {
  transition: flex 0.3s ease;
}
.allocationSegment:hover {
  opacity: 0.8;
}
.allocationEmpty {
  width: 100%;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  padding: var(--spacing-sm) 0;
}
.allocationLegend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
}
.legendItem {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}
.legendDot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  flex-shrink: 0;
}
.legendEmpty {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

/* Transaction section */
.txCard {
  padding: var(--spacing-lg);
}
.txHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.txHeader .sectionTitle {
  margin: 0;
}
.txFilters {
  display: flex;
  gap: var(--spacing-xs);
}
.txFilterBtn {
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.txFilterBtn:hover {
  color: var(--text-secondary);
  border-color: var(--border-color-hover);
}
.txFilterActive {
  color: var(--primary) !important;
  border-color: var(--primary) !important;
  background: var(--primary-glow) !important;
}
.txList {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.txRow {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--border-color);
}
.txRow:last-child {
  border-bottom: none;
}
.txHash {
  font-family: monospace;
  font-size: var(--font-size-xs);
  color: var(--primary);
  text-decoration: none;
  min-width: 100px;
}
.txHash:hover {
  text-decoration: underline;
}
.txDate {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  flex: 1;
}
.txOps {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  min-width: 40px;
  text-align: center;
}
.txEmpty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xl);
  color: var(--text-muted);
}
.txEmpty p {
  margin: 0;
  font-size: var(--font-size-sm);
}

/* NFT Gallery */
.nftHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.nftHeader .sectionTitle {
  margin: 0;
}
.nftViewToggle {
  display: flex;
  gap: 2px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 2px;
}
.viewBtn {
  padding: var(--spacing-xs) var(--spacing-sm);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
}
.viewBtn:hover {
  color: var(--text-secondary);
}
.viewActive {
  background: var(--bg-surface-hover) !important;
  color: var(--primary) !important;
}
.nftGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--spacing-md);
}
.nftList {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.nftCard {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.nftList .nftCard {
  flex-direction: row;
  align-items: center;
}
.nftImage {
  width: 100%;
  height: 160px;
  object-fit: cover;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.nftList .nftImage {
  width: 60px;
  height: 60px;
  border-radius: var(--radius-sm);
}
.nftImagePlaceholder {
  width: 100%;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface-hover);
  color: var(--text-muted);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.nftList .nftCard .nftImagePlaceholder {
  width: 60px;
  height: 60px;
  border-radius: var(--radius-sm);
}
.nftInfo {
  padding: var(--spacing-md);
  flex: 1;
}
.nftName {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  margin: 0 0 var(--spacing-xs) 0;
}
.nftShares {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  margin: 0;
}
.nftActions {
  padding: 0 var(--spacing-md) var(--spacing-md);
}
.nftList .nftActions {
  padding: 0 var(--spacing-md);
}
.nftEmpty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-2xl);
  color: var(--text-muted);
  text-align: center;
}
.nftEmpty p {
  margin: 0;
}
.nftEmptySub {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

/* Activity Timeline */
.timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
  padding-left: var(--spacing-xl);
}
.timeline::before {
  content: '';
  position: absolute;
  left: 14px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--border-color);
}
.timelineItem {
  display: flex;
  gap: var(--spacing-md);
  padding: var(--spacing-md) 0;
  position: relative;
}
.timelineDot {
  position: absolute;
  left: calc(-1 * var(--spacing-xl) + 8px);
  top: var(--spacing-md);
  width: 28px;
  height: 28px;
  border-radius: var(--radius-circle);
  background: var(--bg-surface-hover);
  border: 2px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  z-index: 1;
}
.timelineContent {
  flex: 1;
}
.timelineAction {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  margin: 0 0 2px 0;
}
.timelineDetail {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  margin: 0 0 2px 0;
}
.timelineDate {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}
.timelineEmpty {
  text-align: center;
  color: var(--text-muted);
  padding: var(--spacing-xl);
  font-size: var(--font-size-sm);
}

/* Support Grid */
.supportGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--spacing-md);
}
.supportCard {
  text-align: center;
  padding: var(--spacing-xl);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.supportCard:hover {
  border-color: var(--border-color-hover);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.supportCard h4 {
  margin: var(--spacing-md) 0 var(--spacing-xs) 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}
.supportCard p {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  line-height: 1.4;
}
.supportIcon {
  color: var(--primary);
  opacity: 0.7;
}

/* Preferences Modal */
.prefsForm {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}
.prefGroup {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.prefLabel {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}
.prefSelect {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
}
.prefToggle {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
}
.prefToggle input[type='checkbox'] {
  accent-color: var(--primary);
}
.prefActions {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: flex-end;
  margin-top: var(--spacing-md);
}

/* Responsive */
@media (max-width: 640px) {
  .profileHeader {
    flex-direction: column;
    align-items: stretch;
    text-align: center;
  }
  .profileAvatar {
    margin: 0 auto;
  }
  .walletRow {
    justify-content: center;
    flex-wrap: wrap;
  }
  .walletAddress {
    max-width: 100%;
  }
  .profileActions {
    justify-content: center;
  }
  .summaryGrid {
    grid-template-columns: 1fr;
  }
  .nftGrid {
    grid-template-columns: 1fr;
  }
  .supportGrid {
    grid-template-columns: 1fr;
  }
  .txHeader {
    flex-direction: column;
    align-items: flex-start;
  }
}
"""

os.makedirs(os.path.dirname(CSS_PATH), exist_ok=True)
with open(CSS_PATH, 'w') as f:
    f.write(css_content)
print(f"CSS written: {CSS_PATH} ({len(css_content)} chars)")
